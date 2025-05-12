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
            let authToken;

            before(async () => {
                // Login to get token
                const res = await chai.request(app)
                    .post('/auth/login')
                    .send(testUser);
                authToken = res.body.token;
            });

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
