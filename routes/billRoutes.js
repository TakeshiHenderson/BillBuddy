const express = require('express');
const router = express.Router();
const billService = require('../services/billService');

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

module.exports = router; 