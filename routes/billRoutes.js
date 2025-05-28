const express = require('express');
const router = express.Router();
const billService = require('../services/billService');
const authMiddleware = require('../auth/authMiddleware');
const pool = require('../db');
const { Bill, Item, summarize } = require('../summarize');

// Test route
router.get('/test-bills', (req, res) => {
    console.log('Bill routes test endpoint hit');
    res.json({ message: 'Bill routes are working' });
});

// GET /bills/group/:groupId
router.get('/bills/group/:groupId', async (req, res) => {
    console.log('=== Get Bills by Group Request ===');
    try {
        const bills = await billService.getBillsByGroup(req.params.groupId);
        res.json(bills);
    } catch (error) {
        console.error('Error in GET /bills/group:', error);
        res.status(500).json({ error: 'Failed to get bills' });
    }
});

// GET /bills
router.get('/bills', async (req, res) => {
    console.log('=== Get Bills Request ===');
    try {
        // For now, just return a message
        res.json({ message: 'GET /bills endpoint is working' });
    } catch (error) {
        console.error('Error in GET /bills:', error);
        res.status(500).json({ error: 'Failed to get bills' });
    }
});

// POST /bills
router.post('/bills', async (req, res) => {
    console.log('=== Bill Creation Request ===');
    console.log('Headers:', req.headers);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
  const billData = req.body;

    // Basic validation with detailed logging
    console.log('Validating bill data:', {
        hasBillData: !!billData,
        group_id: billData?.group_id,
        items: billData?.items?.length,
        paid_by: billData?.paid_by,
        rawData: billData
    });

    if (!billData) {
        console.error('No bill data received');
        return res.status(400).json({ error: 'No bill data received' });
    }

    if (!billData.group_id) {
        console.error('Missing group_id');
        return res.status(400).json({ error: 'Missing group_id' });
    }

    if (!billData.items || !Array.isArray(billData.items) || billData.items.length === 0) {
        console.error('Missing or invalid items array');
        return res.status(400).json({ error: 'Missing or invalid items array' });
    }

    if (!billData.paid_by) {
        console.error('Missing paid_by');
        return res.status(400).json({ error: 'Missing paid_by' });
  }

  try {
        console.log('Attempting to save bill...');
    const savedBill = await billService.saveBill(billData);
        console.log('Bill saved successfully:', savedBill);
    res.status(201).json(savedBill);
  } catch (error) {
        console.error('Error saving bill in route handler:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to save bill', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
  }
});

// POST /bills/summarize/:groupId
router.post('/bills/summarize/:groupId', authMiddleware, async (req, res) => {
    console.log('=== Summarize Bills Request ===');
    try {
        const { groupId } = req.params;
        
        // Validate groupId
        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required' });
        }

        // Get all bills for the group
        const bills = await billService.getBillsByGroup(groupId);
        
        if (!bills || bills.length === 0) {
            return res.status(404).json({ error: 'No bills found for this group' });
        }

        // Summarize the bills
        const summary = await billService.summarizeBills(bills, groupId);
        
        console.log('Bills summarized successfully:', summary);
        res.json(summary);
    } catch (error) {
        console.error('Error in summarize bills:', error);
        res.status(500).json({ 
            error: 'Failed to summarize bills',
            details: error.message
        });
    }
});

// GET endpoint for testing bill summarization
router.get('/bills/summarize/:groupId', async (req, res) => {
    console.log('=== Test Summarize Bills Request ===');
    try {
        const { groupId } = req.params;
        
        // Validate groupId
        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required' });
        }

        // Use the service function to handle the summarization
        const summary = await billService.testSummarizeBills(groupId);
        res.json(summary);

    } catch (error) {
        console.error('Error in test summarize bills:', error);
        res.status(500).json({ 
            error: 'Failed to test summarize bills',
            details: error.message
        });
    }
});

module.exports = router; 