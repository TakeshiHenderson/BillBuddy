const express = require('express');
const router = express.Router();
const llmService = require('../services/llmService');
const authMiddleware = require('../auth/authMiddleware');

router.post('/process-bill', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ message: 'Text is required' });
        }

        const result = await llmService.processBillText(text);
        res.json(result);
    } catch (error) {
        console.error('LLM route error:', error);
        res.status(500).json({ message: 'Failed to process bill text' });
    }
});

module.exports = router; 