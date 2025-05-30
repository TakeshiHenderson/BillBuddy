const pool = require('../db'); 
const { v4: uuidv4 } = require('uuid');
const { summarize, Bill, Item } = require('../summarize');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Import the rounding function from summarize.js
// const { roundToTwoDecimals } = require('./summarize');

// Configure multer for bill image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/bills');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'bill-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

const saveBill = async (req, res) => {
    console.log('\n=== Bill Creation Request Service ===');
    console.log('Request Headers:', req.headers);
    console.log('Raw Request Body:', JSON.stringify(req.body, null, 2));
    
    const billData = req.body;

    // Detailed validation logging
    console.log('\n=== Validating Bill Data ===');
    console.log('1. Basic Data Check:', {
        hasBillData: !!billData,
        group_id: billData?.group_id,
        paid_by: billData?.paid_by,
        bill_picture: billData?.bill_picture,
        items_count: billData?.items?.length
    });

    // Validate required fields
    if (!billData) {
        console.error('❌ No bill data received');
        return res.status(400).json({ error: 'No bill data received' });
    }

    if (!billData.group_id) {
        console.error('❌ Missing group_id');
        return res.status(400).json({ error: 'Missing group_id' });
    }

    if (!billData.items || !Array.isArray(billData.items) || billData.items.length === 0) {
        console.error('❌ Missing or invalid items array');
        return res.status(400).json({ error: 'Missing or invalid items array' });
    }

    if (!billData.paid_by) {
        console.error('❌ Missing paid_by');
        return res.status(400).json({ error: 'Missing paid_by' });
    }

    console.log('\n2. Items Validation:');
    billData.items.forEach((item, index) => {
        console.log(`\nItem ${index + 1}:`, {
            name: item.name,
            nominal: item.nominal,
            who_to_paid: item.who_to_paid,
            who_to_paid_count: item.who_to_paid?.length
        });
    });

  const connection = await pool.getConnection();

  try {
        console.log('\n=== Starting Database Transaction ===');
    await connection.beginTransaction();

    // 1. Save to bills table
    const billId = uuidv4();
        console.log('\n1. Inserting Bill:', {
            bill_id: billId,
            group_id: billData.group_id,
            paid_by: billData.paid_by,
            bill_picture: billData.bill_picture,
            date_created: billData.date_created || new Date()
        });

    const insertBillQuery = `
            INSERT INTO bills (bill_id, group_id, paid_by, summarized, bill_picture, date_created)
            VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [billResult] = await connection.execute(
      insertBillQuery,
            [billId, billData.group_id, billData.paid_by, false, billData.bill_picture, billData.date_created || new Date()]
    );
        console.log('✅ Bill inserted successfully');

    // 2. Save to items table
        console.log('\n2. Processing Items for Insertion:');
        const itemInserts = [];
        for (const item of billData.items) {
            console.log(`\nProcessing item: ${item.name}`);
            console.log('Original item data:', {
                name: item.name,
                nominal: item.nominal,
                who_to_paid: item.who_to_paid
            });

            // Calculate nominal per person
      const nominalPerPerson = item.who_to_paid.length > 0 ? item.nominal / item.who_to_paid.length : item.nominal;
            const roundedItemPrice = Math.round(nominalPerPerson);
            
            console.log('Price calculation:', {
                total_nominal: item.nominal,
                users_count: item.who_to_paid.length,
                nominal_per_person: nominalPerPerson,
                rounded_price: roundedItemPrice
            });

            // Create an entry for each user who needs to pay
            for (const userId of item.who_to_paid) {
                const itemId = uuidv4();
                itemInserts.push([
                    itemId,
                    billId,
                    userId,
                    item.name,
                    roundedItemPrice,
                    false
                ]);
                console.log(`Created item entry for user ${userId}:`, {
                    item_id: itemId,
                    bill_id: billId,
                    user_id: userId,
                    item_name: item.name,
                    price: roundedItemPrice
                });
            }
        }

    if (itemInserts.length > 0) {
            console.log('\n3. Inserting Items into Database:');
            console.log(`Total items to insert: ${itemInserts.length}`);
            
      const insertItemQuery = `
        INSERT INTO items (item_id, bill_id, to_be_paid_by, item_name, item_price, already_paid)
        VALUES ?
      `;
      await connection.query(insertItemQuery, [itemInserts]);
            console.log('✅ Items inserted successfully');
        } else {
            console.warn('⚠️ No items to insert');
        }

        await connection.commit();
        console.log('\n✅ Transaction committed successfully');

        // Send success response
        res.status(201).json({ 
            billId, 
            message: 'Bill and items saved successfully',
            items_count: itemInserts.length
        });

    } catch (error) {
        await connection.rollback();
        console.error('\n❌ Error in saveBill service:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage,
            sqlState: error.sqlState
        });
        
        res.status(500).json({ 
            error: 'Failed to save bill', 
            details: error.message,
            code: error.code,
            sqlMessage: error.sqlMessage
        });
    } finally {
        connection.release();
        console.log('\n=== Bill Creation Service Completed ===\n');
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
        console.error('Error in summarizeBills service:', error);
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

// Function to delete a bill by ID
const deleteBill = async (billId) => {
    try {
        // Start a transaction
        await pool.query('BEGIN');

        // Delete associated items first
        await pool.query('DELETE FROM items WHERE bill_id = ?', [billId]);

        // Delete the bill
        const result = await pool.query('DELETE FROM bills WHERE bill_id = ?', [billId]);

        // Check if any rows were affected
        if (result[0].affectedRows === 0) {
            await pool.query('ROLLBACK');
            throw new Error('Bill not found');
        }

        // Commit the transaction
        await pool.query('COMMIT');

        return { message: 'Bill deleted successfully' };
    } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
    }
};

// New function to handle GET bills by group (logic moved from route handler)
const handleGetBillsByGroup = async (req, res) => {
    console.log('=== Get Bills by Group Request Service ===');
    try {
        const bills = await getBillsByGroup(req.params.groupId); // Call the existing getBillsByGroup data fetching function
        res.json(bills); // Send response from service
    } catch (error) {
        console.error('Error in handleGetBillsByGroup service:', error);
        res.status(500).json({ error: 'Failed to get bills' }); // Send error response from service
    }
};

// New function to handle GET bills (logic moved from route handler)
const handleGetBills = async (req, res) => {
    console.log('=== Get Bills Request Service ===');
    try {
        // For now, just return a message
        res.json({ message: 'GET /bills endpoint is working' }); // Send response from service
    } catch (error) {
        console.error('Error in handleGetBills service:', error);
        res.status(500).json({ error: 'Failed to get bills' }); // Send error response from service
    }
};

// New function to handle POST summarize bills (logic moved from route handler)
const handleSummarizeBills = async (req, res) => {
    console.log('=== Summarize Bills Request Service ===');
    try {
        const { groupId } = req.params;
        
        // Validate groupId
        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required' });
        }

        // Get all bills for the group (call existing data fetching function)
        const bills = await getBillsByGroup(groupId);
        
        if (!bills || bills.length === 0) {
            return res.status(404).json({ error: 'No bills found for this group' });
        }

        // Summarize the bills (call existing summarization logic)
        const summary = await summarizeBills(groupId); // summarizeBills now handles data fetching inside
        
        console.log('Bills summarized successfully in service:', summary);
        res.json(summary); // Send response from service
    } catch (error) {
        console.error('Error in handleSummarizeBills service:', error);
        res.status(500).json({ 
            error: 'Failed to summarize bills',
            details: error.message
        }); // Send error response from service
    }
};

// New function to handle GET test summarize bills (logic moved from route handler)
const handleTestSummarizeBills = async (req, res) => {
    console.log('=== Test Summarize Bills Request Service ===');
    try {
        const { groupId } = req.params;
        
        // Validate groupId
        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required' });
        }

        // Use the existing test summarize bills function
        const summary = await testSummarizeBills(groupId);
        res.json(summary); // Send response from service

    } catch (error) {
        console.error('Error in handleTestSummarizeBills service:', error);
        res.status(500).json({ 
            error: 'Failed to test summarize bills',
            details: error.message
        }); // Send error response from service
    }
};

// New function to handle DELETE test delete bills (logic moved from route handler)
const handleTestDeleteBills = async (req, res) => {
    console.log('=== Test Delete Bill Request Service (Bypassing Auth) ===');
    console.log('Attempting to delete bill with ID:', req.params.billId);
    // Call the actual delete service function (it handles the response)
    await deleteBill(req.params.billId);
};

// New function to handle GET a single bill by ID
const handleGetBillById = async (req, res) => {
    console.log('=== Get Bill by ID Request Service ===');
    console.log('Request params:', req.params);
    try {
        const bill = await getBillById(req.params.billId);
        if (!bill) {
            console.log('Bill not found for ID:', req.params.billId);
            return res.status(404).json({ 
                error: 'Bill not found',
                message: `No bill found with ID: ${req.params.billId}`
            });
        }
        console.log('Sending bill response:', {
            bill_id: bill.bill_id,
            item_count: bill.items?.length,
            total_amount: bill.total_amount
        });
        res.json(bill);
    } catch (error) {
        console.error('Error in handleGetBillById service:', error);
        res.status(500).json({ 
            error: 'Failed to get bill',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// New function to handle PUT (update) a bill by ID
const handleUpdateBill = async (req, res) => {
    console.log('=== Update Bill Request Service ===');
    try {
        const updatedBill = await updateBill(req.params.billId, req.body);
        if (!updatedBill) {
            return res.status(404).json({ message: 'Bill not found' });
        }
        res.json(updatedBill);
    } catch (error) {
        console.error('Error in handleUpdateBill service:', error);
        res.status(500).json({ error: 'Failed to update bill' });
    }
};

const createBill = async (billData) => {
  const { group_id, paid_by, items, bill_picture, date_created } = billData;
  
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Generate a UUID for the bill
    const billId = uuidv4();

    // Insert the bill
    const [billResult] = await connection.execute(
      `INSERT INTO bills (bill_id, group_id, paid_by, bill_picture, date_created) 
       VALUES (?, ?, ?, ?, ?)`,
      [billId, group_id, paid_by, bill_picture, date_created || new Date()]
    );

    // Insert bill items
    for (const item of items) {
      const itemId = uuidv4(); // Generate UUID for each item
      await connection.execute(
        `INSERT INTO items (item_id, bill_id, to_be_paid_by, item_name, item_price, already_paid) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, billId, item.who_to_paid[0], item.name, item.nominal, false]
      );
    }

    await connection.commit();
    return { billId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getBillById = async (billId) => {
  const connection = await pool.getConnection();
  try {
    console.log('=== Getting Bill by ID ===');
    console.log('Bill ID:', billId);

    // Get bill details
    const [bills] = await connection.execute(
      `SELECT b.*, u.username as paid_by_name,
        (SELECT COUNT(*) FROM items WHERE bill_id = b.bill_id) as item_count,
        (SELECT SUM(item_price) FROM items WHERE bill_id = b.bill_id) as total_amount
       FROM bills b
       LEFT JOIN users u ON b.paid_by = u.user_id
       WHERE b.bill_id = ?`,
      [billId]
    );

    console.log('Raw bill data from database:', bills);

    if (!bills || bills.length === 0) {
      console.log('No bill found with ID:', billId);
      return null;
    }

    const bill = bills[0];
    console.log('Found bill:', {
      bill_id: bill.bill_id,
      group_id: bill.group_id,
      paid_by: bill.paid_by,
      paid_by_name: bill.paid_by_name,
      bill_picture: bill.bill_picture,
      date_created: bill.date_created,
      item_count: bill.item_count,
      total_amount: bill.total_amount
    });

    // Get items for the bill with usernames and who_to_paid information
    const [items] = await connection.execute(
      `SELECT i.*, 
        GROUP_CONCAT(DISTINCT u.username) as to_be_paid_by_names,
        GROUP_CONCAT(DISTINCT i.to_be_paid_by) as to_be_paid_by_ids
       FROM items i
       LEFT JOIN users u ON i.to_be_paid_by = u.user_id
       WHERE i.bill_id = ?
       GROUP BY i.item_id, i.item_name, i.item_price, i.already_paid`,
      [billId]
    );

    console.log('Raw items data from database:', items);

    // Process items to ensure correct data types and split the concatenated values
    const processedItems = items.map(item => ({
      ...item,
      item_price: Number(item.item_price) || 0,
      already_paid: Boolean(item.already_paid),
      to_be_paid_by: item.to_be_paid_by_ids ? item.to_be_paid_by_ids.split(',') : [],
      to_be_paid_by_names: item.to_be_paid_by_names ? item.to_be_paid_by_names.split(',') : []
    }));

    console.log('Processed items:', processedItems);

    // Add items to bill object
    bill.items = processedItems;

    console.log('Final bill object being returned:', {
      ...bill,
      items: bill.items.map(item => ({
        item_id: item.item_id,
        item_name: item.item_name,
        item_price: item.item_price,
        to_be_paid_by: item.to_be_paid_by,
        to_be_paid_by_names: item.to_be_paid_by_names,
        already_paid: item.already_paid
      }))
    });

    return bill;
  } catch (error) {
    console.error('Error in getBillById:', error);
    throw error;
  } finally {
    connection.release();
  }
};

// Get bill image
const getBillImage = async (billId) => {
  try {
    // Get bill image path from database
    const [bills] = await pool.query(
      'SELECT bill_picture FROM bills WHERE bill_id = ?',
      [billId]
    );

    if (!bills || bills.length === 0) {
      throw new Error('Bill not found');
    }

    const bill = bills[0];
    
    // Read the image file
    const imagePath = path.join(__dirname, '..', bill.bill_picture);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      throw new Error('Bill image not found');
    }

    // Read file and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Get file extension to determine content type
    const ext = path.extname(imagePath).toLowerCase();
    const contentType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png'
    }[ext] || 'image/jpeg';

    return {
      image: `data:${contentType};base64,${base64Image}`
    };
  } catch (error) {
    throw error;
  }
};

// Get bill debug info
const getBillDebugInfo = async (billId) => {
  try {
    // Get bill details from database
    const [bills] = await pool.query(
      'SELECT * FROM bills WHERE bill_id = ?',
      [billId]
    );

    if (!bills || bills.length === 0) {
      throw new Error('Bill not found');
    }

    const bill = bills[0];
    
    // Check if image file exists
    const imagePath = path.join(__dirname, '..', bill.bill_picture);
    const fileExists = fs.existsSync(imagePath);

    return {
      bill,
      imagePath: bill.bill_picture,
      fullPath: imagePath,
      fileExists,
      uploadsDir: path.join(__dirname, '..', 'uploads'),
      billsDir: path.join(__dirname, '..', 'uploads', 'bills')
    };
  } catch (error) {
    throw error;
  }
};

// Check bill status
const checkBillStatus = async (billId) => {
  try {
    // Check if bill exists and get its image path
    const [bills] = await pool.query(
      'SELECT bill_id, bill_picture, date_created FROM bills WHERE bill_id = ?',
      [billId]
    );

    if (!bills || bills.length === 0) {
      throw new Error('Bill not found in database');
    }

    const bill = bills[0];

    // Check if bill_picture is null or empty
    if (!bill.bill_picture) {
      throw new Error('Bill has no image path in database');
    }

    // Check if uploads directory exists
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const billsDir = path.join(uploadsDir, 'bills');
    const uploadsExists = fs.existsSync(uploadsDir);
    const billsDirExists = fs.existsSync(billsDir);

    // Check if image file exists
    const imagePath = path.join(__dirname, '..', bill.bill_picture);
    const fileExists = fs.existsSync(imagePath);

    return {
      bill,
      database: {
        billId: bill.bill_id,
        imagePath: bill.bill_picture,
        dateCreated: bill.date_created
      },
      filesystem: {
        uploadsDir,
        uploadsExists,
        billsDir,
        billsDirExists,
        imagePath,
        fileExists
      }
    };
  } catch (error) {
    throw error;
  }
};

// Handle file upload
const handleFileUpload = async (file) => {
  if (!file) {
    throw new Error('No file uploaded');
  }
  return {
    message: 'File uploaded successfully',
    filePath: `/uploads/bills/${file.filename}`
  };
};

// Handle bill creation with file
const handleBillCreation = async (req) => {
  const { group_id, paid_by, items, date_created } = req.body;
  
  // Validate required fields
  if (!group_id || !paid_by || !items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Missing required fields');
  }

  // Get bill picture path - either from uploaded file or from request body
  let billPicturePath;
  if (req.file) {
    billPicturePath = `/uploads/bills/${req.file.filename}`;
  } else if (req.body.bill_picture) {
    billPicturePath = req.body.bill_picture;
  } else {
    throw new Error('Bill image is required');
  }

  const billData = {
    group_id,
    paid_by,
    items: typeof items === 'string' ? JSON.parse(items) : items,
    bill_picture: billPicturePath,
    date_created: date_created || new Date()
  };

  return await createBill(billData);
};

// Handle bill deletion with file
const handleBillDeletion = async (billId) => {
    try {
        // Get bill image path before deleting
        const [bills] = await pool.query(
            'SELECT bill_picture FROM bills WHERE bill_id = ?',
            [billId]
        );

        if (!bills || bills.length === 0) {
            throw new Error('Bill not found');
        }

        const bill = bills[0];

        // Delete the bill from database
        await deleteBill(billId);

        // Delete the image file if it exists
        if (bill.bill_picture) {
            const imagePath = path.join(__dirname, '..', bill.bill_picture);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        return { message: 'Bill deleted successfully' };
    } catch (error) {
        throw error;
  }
};

// New handler for GET summarize bills
const handleGetSummarizeBills = async (req, res) => {
  console.log('=== Get Summarized Bills Request Service ===');
  try {
    const { groupId } = req.params;

    // Validate groupId
    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }

    // Get the latest invoice for bills in this group
    const [invoices] = await pool.query(
      `SELECT i.* 
       FROM invoice i
       JOIN bills b ON b.date_created BETWEEN i.date_start AND i.date_end
       WHERE b.group_id = ?
       ORDER BY i.date_end DESC
       LIMIT 1`,
      [groupId]
    );

    if (!invoices || invoices.length === 0) {
      console.log(`No summarized data found for group ID: ${groupId}`);
      return res.json({
        groupId: groupId,
        invoice: null,
        records: []
      });
    }

    const latestInvoice = invoices[0];

    // Get records for this invoice with usernames
    const [records] = await pool.query(
      `SELECT r.*, 
        u1.username as debtor_name,
        u2.username as debtee_name
       FROM record r
       JOIN users u1 ON r.debtor = u1.user_id
       JOIN users u2 ON r.debtee = u2.user_id
       WHERE r.invoice_id = ?`,
      [latestInvoice.invoice_id]
    );

    // Calculate total amount
    const totalAmount = records.reduce((sum, record) => sum + Number(record.nominal), 0);

    console.log('Summarized data fetched successfully:', {
      groupId: groupId,
      invoice: latestInvoice,
      records: records.length,
      totalAmount
    });

    // Return the fetched invoice and records
    res.json({
      groupId: groupId,
      invoice: latestInvoice,
      records: records,
      total_amount: totalAmount,
      record_count: records.length
    });

  } catch (error) {
    console.error('Error in handleGetSummarizeBills service:', error);
    res.status(500).json({
      error: 'Failed to get summarized bills',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = {
  saveBill,
  getBillsByGroup,
  summarizeBills,
  testSummarizeBills,
  deleteBill,
  createBill,
  getBillById,
  getBillImage,
  getBillDebugInfo,
  checkBillStatus,
  handleFileUpload,
  handleBillCreation,
  handleBillDeletion,
  upload,
  
  // Export new handlers for routes
  handleGetBillsByGroup,
  handleGetBills,
  handleSummarizeBills,
  handleTestSummarizeBills,
  handleTestDeleteBills,
  handleGetBillById,
  handleUpdateBill,
  handleGetSummarizeBills,
}; 