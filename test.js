const chai = require('chai');
const chaiHttp = require('chai-http');
const expect = chai.expect;
const app = require('./index');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const summarize = require('./summarize');
const { bills, billsWithFees, billsWithSharing, billsWithStandardRates } = require('./dummy/bills');
const passport = require('./passport');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Configure chai to use chai-http
chai.use(chaiHttp);

describe('BillBuddy API Tests', () => {
    let groupId; // Declare groupId at describe scope
    let userIds; // Declare userIds at describe scope

    // Clean up database before tests
    before(async () => {
        // Clean up existing test data
        await pool.query('DELETE FROM record');
        await pool.query('DELETE FROM invoice');
        await pool.query('DELETE FROM items');
        await pool.query('DELETE FROM bills');
        await pool.query('DELETE FROM user_groups');
        await pool.query('DELETE FROM groups');
        await pool.query('DELETE FROM users WHERE email LIKE "test%@example.com"');

        // Insert test users
        userIds = {
            A: uuidv4(),
            B: uuidv4(),
            C: uuidv4(),
            D: uuidv4()
        };

        for (const [user, id] of Object.entries(userIds)) {
            await pool.query(
                'INSERT INTO users (user_id, email) VALUES (?, ?)',
                [id, `test${user.toLowerCase()}@example.com`]
            );
        }

        // Insert test group
        groupId = bills[0].group_id;
        await pool.query(
            'INSERT INTO groups (group_id, group_name) VALUES (?, ?)',
            [groupId, 'Test Group']
        );

        // Add users to group
        for (const userId of Object.values(userIds)) {
            await pool.query(
                'INSERT INTO user_groups (group_id, user_id) VALUES (?, ?)',
                [groupId, userId]
            );
        }
    });

    // Clean up and insert test bills before each test
    beforeEach(async () => {
        // Clean up previous test data
        await pool.query('DELETE FROM record');
        await pool.query('DELETE FROM invoice');
        await pool.query('DELETE FROM items');
        await pool.query('DELETE FROM bills');

        // Insert test bills
        for (const bill of bills) {
            const billId = uuidv4();
            await pool.query(
                'INSERT INTO bills (bill_id, group_id, payed_by, summarized, date_created) VALUES (?, ?, ?, ?, NOW())',
                [billId, groupId, userIds[bill.items[0].paid_by], false]
            );

            for (const item of bill.items) {
                for (const payer of item.who_to_paid) {
                    await pool.query(
                        'INSERT INTO items (item_id, bill_id, to_be_paid_by, item_name, item_price, already_paid) VALUES (?, ?, ?, ?, ?, ?)',
                        [uuidv4(), billId, userIds[payer], 'Test Item', item.nominal, false]
                    );
                }
            }
        }
    });

    describe('Server Setup', () => {
        it('should have express app configured', () => {
            expect(app).to.exist;
            expect(app.use).to.be.a('function');
        });

        it('should have middleware configured', () => {
            expect(app._router).to.exist;
            expect(app._router.stack).to.be.an('array');
        });
    });

    describe('Authentication Routes', () => {
        const testUser = {
            email: 'test@example.com',
            password: 'testPassword123'
        };

        // Assuming a test user is registered and logged in before these tests
        let authToken; // To store the token for authenticated requests
        let testUserId; // To store the test user's ID

        before(async () => {
            // Ensure the test user exists and get their ID
            const [users] = await pool.query('SELECT user_id FROM users WHERE email = ?', [testUser.email]);
            if (users.length > 0) {
                testUserId = users[0].user_id;
            } else {
                // If user doesn't exist, register them
                await chai.request(app)
                    .post('/auth/register')
                    .send(testUser);
                const [newUsers] = await pool.query('SELECT user_id FROM users WHERE email = ?', [testUser.email]);
                testUserId = newUsers[0].user_id;
            }

            // Log in the test user to get a token
            const res = await chai.request(app)
                .post('/auth/login')
                .send(testUser);
            authToken = res.body.token;
        });

        describe('POST /auth/register', () => {
            it('should register a new user successfully', async () => {
                const res = await chai.request(app)
                    .post('/auth/register')
                    .send(testUser);

                expect(res).to.have.status(201);
                expect(res.body).to.have.property('message', 'User registered successfully');

                // Verify user was created in database
                const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [testUser.email]);
                expect(users).to.have.lengthOf(1);
                expect(users[0].email).to.equal(testUser.email);
            });

            it('should not register user with existing email', async () => {
                const res = await chai.request(app)
                    .post('/auth/register')
                    .send(testUser);

                expect(res).to.have.status(400);
                expect(res.body).to.have.property('message', 'Email already exists');
            });
        });

        describe('POST /auth/login', () => {
            it('should login successfully with correct credentials', async () => {
                const res = await chai.request(app)
                    .post('/auth/login')
                    .send(testUser);

                expect(res).to.have.status(200);
                expect(res.body).to.have.property('token');
            });

            it('should not login with incorrect password', async () => {
                const res = await chai.request(app)
                    .post('/auth/login')
                    .send({
                        email: testUser.email,
                        password: 'wrongPassword'
                    });

                expect(res).to.have.status(401);
                expect(res.body).to.have.property('message', 'Invalid email or password');
            });

            it('should not login with non-existent email', async () => {
                const res = await chai.request(app)
                    .post('/auth/login')
                    .send({
                        email: 'nonexistent@example.com',
                        password: 'anyPassword'
                    });

                expect(res).to.have.status(401);
                expect(res.body).to.have.property('message', 'Invalid email or password');
            });
        });

        describe('GET /auth/profile', () => {
            it('should get profile with valid token', async () => {
                const res = await chai.request(app)
                    .get('/auth/profile')
                    .set('Authorization', `Bearer ${authToken}`);

                expect(res).to.have.status(200);
                expect(res.body).to.have.property('email', testUser.email);
            });

            it('should not get profile without token', async () => {
                const res = await chai.request(app)
                    .get('/auth/profile');

                expect(res).to.have.status(401);
            });
        });

        // New tests for Group Functionality
        describe('Group Functionality', () => {
            let testGroupId; // To store the ID of a created test group

            // Clean up test groups and user_groups after these tests
            after(async () => {
                await pool.query('DELETE FROM user_groups WHERE user_id = ?', [testUserId]);
                // Optional: Clean up groups created during tests if they are not linked to other users
                // await pool.query('DELETE FROM groups WHERE group_id = ?', [testGroupId]);
            });

            // Ensure a group exists before running tests that require one
            beforeEach(async () => {
                // Create a test group if it doesn't exist
                if (!testGroupId) {
                    const groupName = 'Temporary Test Group';
                    const res = await chai.request(app)
                        .post('/auth/groups')
                        .set('Authorization', `Bearer ${authToken}`)
                        .send({ groupName });
                    testGroupId = res.body.group.group_id;
                }
            });

            describe('POST /auth/groups', () => {
                it('should create a new group successfully', async () => {
                    const groupName = 'Test Group to Create';
                    const res = await chai.request(app)
                        .post('/auth/groups')
                        .set('Authorization', `Bearer ${authToken}`)
                        .send({ groupName });

                    expect(res).to.have.status(201);
                    expect(res.body).to.have.property('message', 'Group created successfully');
                    expect(res.body).to.have.property('group').to.be.an('object');
                    expect(res.body.group).to.have.property('group_id').to.be.a('string');
                    expect(res.body.group).to.have.property('group_name', groupName);

                    // Store the created group ID for later tests
                    testGroupId = res.body.group.group_id;

                    // Verify group was created in database
                    const [groups] = await pool.query('SELECT * FROM groups WHERE group_id = ?', [testGroupId]);
                    expect(groups).to.have.lengthOf(1);
                    expect(groups[0].group_name).to.equal(groupName);

                    // Verify user_group entry was created
                    const [userGroups] = await pool.query('SELECT * FROM user_groups WHERE group_id = ? AND user_id = ?', [testGroupId, testUserId]);
                    expect(userGroups).to.have.lengthOf(1);
                });

                it('should not create a group without authentication', async () => {
                    const groupName = 'Unauthorized Group';
                    const res = await chai.request(app)
                        .post('/auth/groups')
                        .send({ groupName });

                    expect(res).to.have.status(401);
                });

                it('should not create a group without group name', async () => {
                    const res = await chai.request(app)
                        .post('/auth/groups')
                        .set('Authorization', `Bearer ${authToken}`)
                        .send({}); // Missing groupName

                    expect(res).to.have.status(400);
                    expect(res.body).to.have.property('message', 'Group name is required');
                });
            });

            describe('GET /auth/groups', () => {
                it('should get the authenticated user\'s groups', async () => {
                    const res = await chai.request(app)
                        .get('/auth/groups')
                        .set('Authorization', `Bearer ${authToken}`);

                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('array');
                    // Check if the created test group is in the list
                    const createdGroup = res.body.find(group => group.group_id === testGroupId);
                    expect(createdGroup).to.exist;
                    expect(createdGroup).to.have.property('group_name', 'Temporary Test Group');
                });

                it('should not get groups without authentication', async () => {
                    const res = await chai.request(app)
                        .get('/auth/groups');

                    expect(res).to.have.status(401);
                });
            });

            describe('GET /auth/groups/:groupId', () => {
                it('should get a specific group by ID for a member', async () => {
                    const res = await chai.request(app)
                        .get(`/auth/groups/${testGroupId}`)
                        .set('Authorization', `Bearer ${authToken}`);

                    expect(res).to.have.status(200);
                    expect(res.body).to.be.an('object');
                    expect(res.body).to.have.property('group_id', testGroupId);
                    expect(res.body).to.have.property('group_name', 'Temporary Test Group');
                    expect(res.body).to.have.property('members').to.be.an('array');
                    // Check if the current user is in the members list
                    const currentUserMember = res.body.members.find(member => member.id === testUserId);
                    expect(currentUserMember).to.exist;
                });

                it('should not get a specific group by ID for a non-member', async () => {
                    // Create another user who is not a member of testGroupId
                    const anotherUser = {
                         email: 'anotheruser@example.com',
                         password: 'anotherPassword123'
                    };
                    await chai.request(app).post('/auth/register').send(anotherUser);
                    const loginRes = await chai.request(app).post('/auth/login').send(anotherUser);
                    const anotherAuthToken = loginRes.body.token;

                    const res = await chai.request(app)
                        .get(`/auth/groups/${testGroupId}`)
                        .set('Authorization', `Bearer ${anotherAuthToken}`);

                    expect(res).to.have.status(404); // Or 403 depending on desired behavior for non-members
                    expect(res.body).to.have.property('message');

                    // Clean up the extra user
                    // Note: Deleting user might require a backend endpoint or manual cleanup
                    const [anotherUserRow] = await pool.query('SELECT user_id FROM users WHERE email = ?', [anotherUser.email]);
                    if (anotherUserRow.length > 0) {
                        await pool.query('DELETE FROM users WHERE user_id = ?', [anotherUserRow[0].user_id]);
                    }
                });

                 it('should not get a specific group by ID without authentication', async () => {
                    const res = await chai.request(app)
                        .get(`/auth/groups/${testGroupId}`);

                    expect(res).to.have.status(401);
                });

                 it('should return 404 for a non-existent group ID', async () => {
                    const nonExistentGroupId = '00000000-0000-0000-0000-000000000000'; // Example non-existent UUID
                    const res = await chai.request(app)
                        .get(`/auth/groups/${nonExistentGroupId}`)
                        .set('Authorization', `Bearer ${authToken}`);

                    expect(res).to.have.status(404);
                    expect(res.body).to.have.property('message');
                 });
            });

            // New tests for Joining Group Functionality
            describe('POST /auth/groups/:groupId/join', () => {
                let anotherUserId; // To store the ID of another test user
                let anotherAuthToken; // To store the token for another test user

                before(async () => {
                    // Create and login another user who is not yet a member of testGroupId
                    const anotherUser = {
                         email: 'joinuser@example.com',
                         password: 'joinPassword123'
                    };
                    await chai.request(app).post('/auth/register').send(anotherUser);
                    const loginRes = await chai.request(app).post('/auth/login').send(anotherUser);
                    anotherAuthToken = loginRes.body.token;

                    const [anotherUserRow] = await pool.query('SELECT user_id FROM users WHERE email = ?', [anotherUser.email]);
                    anotherUserId = anotherUserRow[0].user_id;
                });

                after(async () => {
                    // Clean up the user_group entry and the extra user after tests
                    await pool.query('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?', [anotherUserId, testGroupId]);
                    await pool.query('DELETE FROM users WHERE user_id = ?', [anotherUserId]);
                });

                it('should allow an authenticated user to join a group', async () => {
                    const res = await chai.request(app)
                        .post(`/auth/groups/${testGroupId}/join`)
                        .set('Authorization', `Bearer ${anotherAuthToken}`);

                    expect(res).to.have.status(200);
                    expect(res.body).to.have.property('message', 'Successfully joined the group');

                    // Verify user_group entry was created
                    const [userGroups] = await pool.query('SELECT * FROM user_groups WHERE group_id = ? AND user_id = ?', [testGroupId, anotherUserId]);
                    expect(userGroups).to.have.lengthOf(1);
                });

                it('should not allow an authenticated user to join a group they are already a member of', async () => {
                    // First, ensure the user is a member (from the previous test or explicitly add them)
                     await pool.query('INSERT INTO user_groups (group_id, user_id) VALUES (?, ?)', [testGroupId, anotherUserId]);

                    const res = await chai.request(app)
                        .post(`/auth/groups/${testGroupId}/join`)
                        .set('Authorization', `Bearer ${anotherAuthToken}`);

                    expect(res).to.have.status(400);
                    expect(res.body).to.have.property('message', 'You are already a member of this group');
                });

                it('should not allow joining a non-existent group', async () => {
                    const nonExistentGroupId = '11111111-1111-1111-1111-111111111111'; // Another non-existent UUID
                    const res = await chai.request(app)
                        .post(`/auth/groups/${nonExistentGroupId}/join`)
                        .set('Authorization', `Bearer ${anotherAuthToken}`);

                    expect(res).to.have.status(404);
                    expect(res.body).to.have.property('message', 'Group not found');
                });

                it('should not allow joining a group without authentication', async () => {
                     const res = await chai.request(app)
                        .post(`/auth/groups/${testGroupId}/join`);

                     expect(res).to.have.status(401);
                });
            });
        });
    });

    describe('OAuth Routes', () => {
        it('should have Google OAuth routes configured', () => {
            const routes = app._router.stack
                .filter(layer => layer.route)
                .map(layer => layer.route.path);
            
            expect(routes).to.include('/auth/google');
            expect(routes).to.include('/auth/google/callback');
        });
    });

    describe('Routes', () => {
        it('should have dashboard route configured', () => {
            const routes = app._router.stack
                .filter(layer => layer.route)
                .map(layer => layer.route.path);
            
            expect(routes).to.include('/dashboard');
        });
    });

    describe('Bill Summarization', () => {
        it('should correctly summarize bills with multiple people and insert into database', async () => {
            const result = await summarize(bills, groupId);
            
            expect(result).to.be.an('array');
            expect(result[0]).to.have.all.keys(['from', 'to', 'nominal']);
            
            // In the test data:
            // - B paid 10000 for A
            // - B paid 5000 for C
            // - A paid 5000 for B
            // Expected result should show:
            // - A needs to pay B 5000
            // - C needs to pay B 5000
            
            const aToB = result.find(r => r.from === 'A' && r.to === 'B');
            const cToB = result.find(r => r.from === 'C' && r.to === 'B');
            
            expect(aToB).to.exist;
            expect(cToB).to.exist;
            expect(aToB.nominal).to.equal(5000);
            expect(cToB.nominal).to.equal(5000);

            // Verify records were inserted into database
            const [records] = await pool.query(
                'SELECT r.*, u1.email as debtor_email, u2.email as debtee_email FROM record r ' +
                'JOIN users u1 ON r.debtor = u1.user_id ' +
                'JOIN users u2 ON r.debtee = u2.user_id ' +
                'JOIN invoice i ON r.invoice_id = i.invoice_id ' +
                'WHERE i.date_start = (SELECT MIN(date_created) FROM bills WHERE group_id = ?)',
                [groupId]
            );

            expect(records).to.have.lengthOf(2);
            const dbAToB = records.find(r => r.debtor_email === 'testa@example.com' && r.debtee_email === 'testb@example.com');
            const dbCToB = records.find(r => r.debtor_email === 'testc@example.com' && r.debtee_email === 'testb@example.com');

            expect(dbAToB).to.exist;
            expect(dbCToB).to.exist;
            expect(dbAToB.nominal).to.equal(5000);
            expect(dbCToB.nominal).to.equal(5000);
        });

        it('should handle bills with tax, service, and discount with proper rounding and insert into database', async () => {
            // Clean up and insert bills with fees
            await pool.query('DELETE FROM items');
            await pool.query('DELETE FROM bills');
            
            for (const bill of billsWithFees) {
                const billId = uuidv4();
                await pool.query(
                    'INSERT INTO bills (bill_id, group_id, payed_by, summarized, date_created) VALUES (?, ?, ?, ?, NOW())',
                    [billId, groupId, userIds[bill.items[0].paid_by], false]
                );

                for (const item of bill.items) {
                    for (const payer of item.who_to_paid) {
                        await pool.query(
                            'INSERT INTO items (item_id, bill_id, to_be_paid_by, item_name, item_price, already_paid) VALUES (?, ?, ?, ?, ?, ?)',
                            [uuidv4(), billId, userIds[payer], 'Test Item', item.nominal, false]
                        );
                    }
                }
            }

            const result = await summarize(billsWithFees, groupId);
            
            // Calculate expected amount with rounding:
            // 10000 + (10000 * 0.1) + (10000 * 0.05) - (10000 * 0.02)
            // = 10000 + 1000 + 500 - 200
            // = 11300
            // After rounding to 2 decimal places: 11300.00
            const expectedAmount = 11300.00;
            
            expect(result).to.be.an('array');
            expect(result[0]).to.have.property('nominal', expectedAmount);

            // Verify record was inserted into database
            const [records] = await pool.query(
                'SELECT r.*, u1.email as debtor_email, u2.email as debtee_email FROM record r ' +
                'JOIN users u1 ON r.debtor = u1.user_id ' +
                'JOIN users u2 ON r.debtee = u2.user_id ' +
                'JOIN invoice i ON r.invoice_id = i.invoice_id ' +
                'WHERE i.date_start = (SELECT MIN(date_created) FROM bills WHERE group_id = ?)',
                [groupId]
            );

            expect(records).to.have.lengthOf(1);
            expect(records[0].nominal).to.equal(expectedAmount);
        });

        it('should handle bills with multiple people sharing an item with proper rounding and insert into database', async () => {
            const result = await summarize(billsWithSharing, groupId);
            // Each person should pay 10000/3 = 3333.33
            // After rounding to 2 decimal places: 3333.33
            const expectedAmount = 3333.33;
            
            expect(result).to.be.an('array');
            expect(result).to.have.lengthOf(3); // Three people need to pay
            
            // Check that each person's payment is correct and rounded
            result.forEach(payment => {
                expect(payment.to).to.equal('D');
                expect(payment.nominal).to.equal(expectedAmount);
            });

            // Verify records were inserted into database
            const [records] = await pool.query(
                'SELECT r.*, u1.email as debtor_email, u2.email as debtee_email FROM record r ' +
                'JOIN users u1 ON r.debtor = u1.user_id ' + 
                'JOIN users u2 ON r.debtee = u2.user_id ' +
                'JOIN invoice i ON r.invoice_id = i.invoice_id ' +
                'WHERE i.date_start = (SELECT MIN(date_created) FROM bills WHERE group_id = ?)',
                [groupId]
            );

            expect(records).to.have.lengthOf(3);
            records.forEach(record => {
                expect(record.debtee_email).to.equal('testd@example.com');
                expect(record.nominal).to.equal(expectedAmount);
            });
        });

        it('should handle bills with standard tax and service rates and insert into database', async () => {
            const result = await summarize(billsWithStandardRates, groupId);
            
            // Calculate expected amount:
            // Base amount: 100000
            // Tax (11%): 100000 * 0.11 = 11000
            // Service (6%): 100000 * 0.06 = 6000
            // Total: 100000 + 11000 + 6000 = 117000
            // Split between 2 people: 117000 / 2 = 58500
            const expectedAmount = 58500.00;
            
            expect(result).to.be.an('array');
            expect(result).to.have.lengthOf(2); // Two people need to pay
            
            // Check that each person's payment is correct and rounded
            result.forEach(payment => {
                expect(payment.to).to.equal('C');
                expect(payment.nominal).to.equal(expectedAmount);
            });

            // Verify records were inserted into database
            const [records] = await pool.query(
                'SELECT r.*, u1.email as debtor_email, u2.email as debtee_email FROM record r ' +
                'JOIN users u1 ON r.debtor = u1.user_id ' +
                'JOIN users u2 ON r.debtee = u2.user_id ' +
                'JOIN invoice i ON r.invoice_id = i.invoice_id ' +
                'WHERE i.date_start = (SELECT MIN(date_created) FROM bills WHERE group_id = ?)',
                [groupId]
            );

            expect(records).to.have.lengthOf(2);
            records.forEach(record => {
                expect(record.debtee_email).to.equal('testc@example.com');
                expect(record.nominal).to.equal(expectedAmount);
            });
        });

        it('should handle empty bills array', async () => {
            const result = await summarize([], groupId);
            expect(result).to.be.an('array');
            expect(result).to.have.lengthOf(0);

            // Verify no records were inserted
            const [records] = await pool.query(
                'SELECT COUNT(*) as count FROM record r ' +
                'JOIN invoice i ON r.invoice_id = i.invoice_id ' +
                'WHERE i.date_start = (SELECT MIN(date_created) FROM bills WHERE group_id = ?)',
                [groupId]
            );
            expect(records[0].count).to.equal(0);
        });
    });
});
