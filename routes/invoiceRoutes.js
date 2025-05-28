const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../auth/authMiddleware');

// GET /invoices/group/:groupId
router.get('/invoices/group/:groupId', authMiddleware, async (req, res) => {
    console.log('=== Get Invoices by Group Request ===');
    try {
        const { groupId } = req.params;

        // Get all invoices for the group based on bill date ranges
        const [invoices] = await pool.query(
            `SELECT i.*, 
                (SELECT COUNT(*) FROM record WHERE invoice_id = i.invoice_id) as record_count,
                (SELECT SUM(nominal) FROM record WHERE invoice_id = i.invoice_id) as total_amount
             FROM invoice i
             WHERE EXISTS (
                SELECT 1 FROM bills b 
                WHERE b.group_id = ? 
                AND b.date_created BETWEEN i.date_start AND i.date_end
             )
             ORDER BY i.date_start DESC`,
            [groupId]
        );

        // Get records for each invoice
        for (let invoice of invoices) {
            const [records] = await pool.query(
                `SELECT r.*, 
                    u1.username as debtor_name,
                    u2.username as debtee_name
                 FROM record r
                 LEFT JOIN users u1 ON r.debtor = u1.user_id
                 LEFT JOIN users u2 ON r.debtee = u2.user_id
                 WHERE r.invoice_id = ?`,
                [invoice.invoice_id]
            );
            invoice.records = records;
        }

        res.json(invoices);
    } catch (error) {
        console.error('Error in GET /invoices/group:', error);
        res.status(500).json({ error: 'Failed to get invoices' });
    }
});

module.exports = router; 