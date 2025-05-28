const pool = require('../db'); 
const { v4: uuidv4 } = require('uuid');
const { summarize, Bill, Item } = require('../summarize');

// Import the rounding function from summarize.js
// const { roundToTwoDecimals } = require('./summarize');

const saveBill = async (billData) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Save to bills table
    const billId = uuidv4();
    const insertBillQuery = `
      INSERT INTO bills (bill_id, group_id, paid_by, summarized, date_created)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [billResult] = await connection.execute(
      insertBillQuery,
      [billId, billData.group_id, billData.paid_by, false, billData.date_created]
    );

    // 2. Save to items table
    const itemInserts = billData.items.flatMap(item => {
      // Calculate nominal per person, ensuring it's a number
      let nominalPerPerson = item.who_to_paid.length > 0 ? item.nominal / item.who_to_paid.length : item.nominal;
      
      // Round to the nearest integer for the database INT column
      const roundedItemPrice = Math.round(nominalPerPerson);

      return item.who_to_paid.map(memberId => [
        uuidv4(), // item_id
        billId, // bill_id
        memberId, // to_be_paid_by
        item.name, // item_name
        roundedItemPrice, // item_price (share per person) - rounded
        false // already_paid
      ]);
    });

    if (itemInserts.length > 0) {
      const insertItemQuery = `
        INSERT INTO items (item_id, bill_id, to_be_paid_by, item_name, item_price, already_paid)
        VALUES ?
      `;
      await connection.query(insertItemQuery, [itemInserts]);
    }

    await connection.commit();

    return { billId, message: 'Bill and items saved successfully' };

  } catch (error) {
    await connection.rollback();
    console.error('Error in saveBill:', error);
    throw error; // Re-throw the error to be caught by the route handler
  } finally {
    connection.release();
  }
};

const getBillsByGroup = async (groupId) => {
  const connection = await pool.getConnection();
  try {
    const [bills] = await connection.execute(
      `SELECT b.*, u.username as paid_by_name, 
        (SELECT COUNT(*) FROM items WHERE bill_id = b.bill_id) as item_count,
        (SELECT SUM(item_price) FROM items WHERE bill_id = b.bill_id) as total_amount
       FROM bills b
       LEFT JOIN users u ON b.paid_by = u.user_id
       WHERE b.group_id = ?
       ORDER BY b.date_created DESC`,
      [groupId]
    );

    // Get items for each bill
    for (let bill of bills) {
      const [items] = await connection.execute(
        `SELECT i.*, u.username as paid_by_name
         FROM items i
         LEFT JOIN users u ON i.to_be_paid_by = u.user_id
         WHERE i.bill_id = ?`,
        [bill.bill_id]
      );
      bill.items = items;
    }

    return bills;
  } finally {
    connection.release();
  }
};

const summarizeBills = async (groupId) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Get all unsummarized bills for this group
        const [unsummarizedBills] = await connection.execute(
            `SELECT b.*, u.username as paid_by_name, 
                (SELECT COUNT(*) FROM items WHERE bill_id = b.bill_id) as item_count,
                (SELECT SUM(item_price) FROM items WHERE bill_id = b.bill_id) as total_amount
             FROM bills b
             LEFT JOIN users u ON b.paid_by = u.user_id
             WHERE b.group_id = ? AND b.summarized = false
             ORDER BY b.date_created DESC`,
            [groupId]
        );

        // Get items for each bill
        for (let bill of unsummarizedBills) {
            const [items] = await connection.execute(
                `SELECT i.*, u.username as paid_by_name
                 FROM items i
                 LEFT JOIN users u ON i.to_be_paid_by = u.user_id
                 WHERE i.bill_id = ?`,
                [bill.bill_id]
            );
            bill.items = items;
        }

        // Convert bills to Bill instances with Item instances
        const formattedBills = unsummarizedBills.map(bill => {
            const billInstance = new Bill();
            
            // Add each item to the bill
            bill.items.forEach(item => {
                const itemInstance = new Item(
                    item.item_price,  // nominal
                    [item.to_be_paid_by],  // who_to_paid
                    bill.paid_by  // paid_by
                );
                billInstance.addItem(itemInstance);
            });

            return billInstance;
        });

        // Use the existing summarize function
        const records = await summarize(formattedBills, groupId);

        await connection.commit();

        // Return summary for frontend display
        return {
            group_id: groupId,
            total_bills: unsummarizedBills.length,
            total_amount: unsummarizedBills.reduce((sum, bill) => sum + bill.total_amount, 0),
            records: records,
            date_created: new Date().toISOString()
        };

    } catch (error) {
        await connection.rollback();
        console.error('Error in summarizeBills:', error);
        throw error;
    } finally {
        connection.release();
    }
};

async function testSummarizeBills(groupId) {
    console.log('\n=== Starting Test Summarize Bills Service ===');
    console.log('Group ID:', groupId);
    
    try {
        // Get all unsummarized bills for the group
        console.log('\n1. Fetching unsummarized bills...');
        const [unsummarizedBills] = await pool.query(
            `SELECT b.*, u.username as paid_by_name, 
                (SELECT COUNT(*) FROM items WHERE bill_id = b.bill_id) as item_count,
                (SELECT SUM(item_price) FROM items WHERE bill_id = b.bill_id) as total_amount
             FROM bills b
             LEFT JOIN users u ON b.paid_by = u.user_id
             WHERE b.group_id = ? AND b.summarized = false
             ORDER BY b.date_created DESC`,
            [groupId]
        );

        console.log('\n=== Unsummarized Bills Details ===');
        console.log('Number of bills found:', unsummarizedBills.length);
        console.log('Bills data:', JSON.stringify(unsummarizedBills, null, 2));

        if (!unsummarizedBills || unsummarizedBills.length === 0) {
            throw new Error('No unsummarized bills found for this group');
        }

        // Get items for each bill
        console.log('\n2. Fetching items for each bill...');
        for (let bill of unsummarizedBills) {
            console.log(`\nProcessing bill ${bill.bill_id}:`);
            console.log('Bill paid by:', bill.paid_by);
            console.log('Bill paid by name:', bill.paid_by_name);
            
            const [items] = await pool.query(
                `SELECT i.*, u.username as paid_by_name
                 FROM items i
                 LEFT JOIN users u ON i.to_be_paid_by = u.user_id
                 WHERE i.bill_id = ?`,
                [bill.bill_id]
            );
            bill.items = items;
            
            console.log(`Items for Bill ${bill.bill_id}:`);
            console.log('Number of items:', items.length);
            console.log('Items data:', JSON.stringify(items, null, 2));
        }

        // Convert bills to Bill instances with Item instances
        console.log('\n3. Converting bills to Bill instances...');
        const formattedBills = unsummarizedBills.map(bill => {
            console.log(`\nConverting bill ${bill.bill_id}:`);
            const billInstance = new Bill();
            
            // Add each item to the bill
            bill.items.forEach(item => {
                console.log(`Processing item:`, {
                    item_price: item.item_price,
                    to_be_paid_by: item.to_be_paid_by,
                    paid_by: bill.paid_by
                });
                
                const itemInstance = new Item(
                    item.item_price,  // nominal
                    [item.to_be_paid_by],  // who_to_paid
                    bill.paid_by  // paid_by
                );
                billInstance.addItem(itemInstance);
            });

            return billInstance;
        });

        console.log('\n4. Calling summarize function...');
        // Use the summarize function to get the records
        const records = await summarize(formattedBills, groupId);
        console.log('\nSummarize function returned records:', JSON.stringify(records, null, 2));

        const result = {
            group_id: groupId,
            total_bills: unsummarizedBills.length,
            total_amount: unsummarizedBills.reduce((sum, bill) => sum + bill.total_amount, 0),
            records: records,
            date_created: new Date().toISOString()
        };

        console.log('\n=== Final Result ===');
        console.log(result.total_amount)
        console.log(JSON.stringify(result, null, 2));

        return result;

    } catch (error) {
        console.error('\n=== Error in test summarize bills ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

module.exports = {
  saveBill,
  getBillsByGroup,
  summarizeBills,
  testSummarizeBills
}; 