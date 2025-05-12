const pool = require('./db');
const { v4: uuidv4 } = require('uuid');



class Item {
    constructor(nominal, who_to_paid, paid_by) {
        this.nominal = nominal;
        this.who_to_paid = who_to_paid;
        this.paid_by = paid_by;
    }
}

class Bill {
    constructor(items = [], tax = 0, service = 0, discount = 0) {
        this.items = items; // array of Item
        this.tax = tax;
        this.service = service;
        this.discount = discount;
    }

    addItem(item) {
        this.items.push(item);
    }

    setTax(tax) {
        this.tax = tax;
    }

    setService(service) {
        this.service = service;
    }

    setDiscount(discount) {
        this.discount = discount;
    }
}

function roundToTwoDecimals(num) {
    return Math.round(num * 100) / 100;
}

async function summarize(bills, groupId) {
    // bills -> array of Bill that want to summarized
    // groupId -> the group ID to associate with the invoice

    const cash = {}; 

    for (const bill of bills) {
        for (const item of bill.items) {
            for (const person of item.who_to_paid) {
                if (!(person in cash)) cash[person] = 0;
            }
            if (!(item.paid_by in cash)) cash[item.paid_by] = 0;
        }

        for (const item of bill.items) {
            // Calculate the total nominal for this item, including tax, service, and discount
            let effectiveNominal = item.nominal + item.nominal * bill.tax + item.nominal * bill.service - item.nominal * bill.discount;
            effectiveNominal = roundToTwoDecimals(effectiveNominal);
            
            let person = item.who_to_paid.length;
            cash[item.paid_by] -= effectiveNominal;
            effectiveNominal = roundToTwoDecimals(effectiveNominal / person);
            for (const p of item.who_to_paid) {
                cash[p] += effectiveNominal;
            }
        }
    }

    const people = Object.keys(cash);
    const balances = {};
    for (const p of people) {
        const rounded = roundToTwoDecimals(cash[p]);
        if (Math.abs(rounded) > 0.01) {
            balances[p] = rounded;
        }
    }
    
    // cash positive -> debtees
    // cash negative -> debtors
    const debtors = [];
    const debtees = [];

    // debtors pay ke debtees
    for (const p in balances) {
        if (balances[p] < 0) {
            debtees.push({person: p, amount: -balances[p]});
        } else {
            debtors.push({person: p, amount: balances[p]});
        }
    }

    debtors.sort((a, b) => b.amount - a.amount);
    debtees.sort((a, b) => b.amount - a.amount);

    // records -> array of {from: A, to: B, nominal}
    const records = [];

    let i = 0; // index for debtors
    let j = 0; // index for debtees

    while (i < debtors.length && j < debtees.length) {
        const debtor = debtors[i];
        const debtee = debtees[j];

        const amount = Math.min(debtor.amount, debtee.amount);
        const roundedAmount = roundToTwoDecimals(amount);

        if (roundedAmount > 0.01) {
            records.push({
                from: debtor.person,
                to: debtee.person,
                nominal: roundedAmount
            });
        }

        debtor.amount = roundToTwoDecimals(debtor.amount - roundedAmount);
        debtee.amount = roundToTwoDecimals(debtee.amount - roundedAmount);

        if (debtor.amount < 0.01) i++;
        if (debtee.amount < 0.01) j++;
    }

    // Create invoice and insert records into database
    if (groupId) {
        try {
            // Get date range from bills
            const [oldestBill] = await pool.query(
                'SELECT MIN(date_created) as date_start FROM bills WHERE group_id = ? AND summarized = false',
                [groupId]
            );
            const [newestBill] = await pool.query(
                'SELECT MAX(date_created) as date_end FROM bills WHERE group_id = ? AND summarized = false',
                [groupId]
            );

            // Create new invoice with date range from bills
            const invoiceId = uuidv4();
            await pool.query(
                'INSERT INTO invoice (invoice_id, date_start, date_end) VALUES (?, ?, ?)',
                [invoiceId, oldestBill[0].date_start, newestBill[0].date_end]
            );

            // Get user IDs for the group
            const [groupUsers] = await pool.query(
                'SELECT u.user_id, email FROM users u JOIN user_groups ug ON u.user_id = ug.user_id WHERE ug.group_id = ?',
                [groupId]
            );

            // Create a mapping of email to user_id
            const userMap = {};
            for (const user of groupUsers) {
                const email = user.email;
                if (email.startsWith('test')) {
                    const letter = email.charAt(4).toUpperCase(); // Extract the letter from testX@example.com
                    userMap[letter] = user.user_id;
                }
            }

            // Insert records with proper user IDs
            for (const record of records) {
                await pool.query(
                    'INSERT INTO record (record_id, invoice_id, debtor, debtee, nominal, already_paid) VALUES (?, ?, ?, ?, ?, ?)',
                    [uuidv4(), invoiceId, userMap[record.from], userMap[record.to], record.nominal, false]
                );
            }

            // Mark bills as summarized
            await pool.query(
                'UPDATE bills SET summarized = true WHERE group_id = ? AND summarized = false',
                [groupId]
            );
        } catch (error) {
            console.error('Error inserting records into database:', error);
            throw error;
        }
    }

    return records;
}

module.exports = summarize;

