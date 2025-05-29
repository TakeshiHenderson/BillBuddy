const express = require('express');
const router = express.Router();
const billService = require('../services/billService');
const authMiddleware = require('../auth/authMiddleware');
const pool = require('../db');
const { Bill, Item, summarize } = require('../summarize');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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

// Test route
router.get('/test-bills', (req, res) => {
    console.log('Bill routes test endpoint hit');
    res.json({ message: 'Bill routes are working' });
});

// Get bills by group
router.get('/bills/group/:groupId', billService.handleGetBillsByGroup);

// Get all bills
router.get('/bills', billService.handleGetBills);

// Get bill image (public endpoint, no auth required)
router.get('/bills/:billId/image', async (req, res) => {
  try {
    const result = await billService.getBillImage(req.params.billId);
    res.json(result);
  } catch (error) {
    console.error('Error getting bill image:', error);
    res.status(500).json({ 
      error: 'Failed to get bill image',
      details: error.message
    });
  }
});

// Apply auth middleware for protected routes
router.use(authMiddleware);

// Create new bill with image upload
router.post('/bills', billService.upload.single('bill_picture'), async (req, res) => {
  try {
    // Add the file path to the request body if a file was uploaded
    if (req.file) {
      req.body.bill_picture = `/uploads/bills/${req.file.filename}`;
    }
    
    // Call saveBill directly
    await billService.saveBill(req, res);
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({ 
      error: 'Failed to create bill',
      details: error.message 
    });
  }
});

// Delete bill (including image file)
router.delete('/bills/:billId', async (req, res) => {
  try {
    const result = await billService.handleBillDeletion(req.params.billId);
    res.json(result);
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(error.message === 'Bill not found' ? 404 : 500).json({ 
      error: 'Failed to delete bill',
      details: error.message 
    });
  }
});

// Other routes
router.delete('/test-delete-bills/:billId', billService.handleTestDeleteBills);
router.post('/bills/summarize/:groupId', billService.handleSummarizeBills);
router.get('/bills/:billId', billService.handleGetBillById);
router.put('/bills/:billId', billService.handleUpdateBill);

// Get bill details including image path (for debugging)
router.get('/bills/:billId/debug', async (req, res) => {
  try {
    const result = await billService.getBillDebugInfo(req.params.billId);
    res.json(result);
  } catch (error) {
    console.error('Error getting bill debug info:', error);
    res.status(500).json({ 
      error: 'Failed to get bill debug info',
      details: error.message
    });
  }
});

// Debug route to check database
router.get('/bills/:billId/check', async (req, res) => {
  try {
    const result = await billService.checkBillStatus(req.params.billId);
    res.json(result);
  } catch (error) {
    console.error('Error checking bill:', error);
    res.status(500).json({ 
      error: 'Failed to check bill',
      details: error.message
    });
  }
});

// Upload bill image
router.post('/upload', authMiddleware, billService.upload.single('bill_picture'), async (req, res) => {
  try {
    const result = await billService.handleFileUpload(req.file);
    res.json(result);
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ 
      error: 'Failed to upload image',
      details: error.message 
    });
  }
});

// Summarize bills
router.post('/bills/summarize/:groupId', billService.handleSummarizeBills);

// Test summarize bills (for development only)
router.post('/bills/test-summarize/:groupId', billService.handleTestSummarizeBills);

module.exports = router; 