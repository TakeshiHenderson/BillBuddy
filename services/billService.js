const pool = require('../db'); 
const { v4: uuidv4 } = require('uuid');

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

module.exports = {
  saveBill,
  getBillsByGroup
}; 