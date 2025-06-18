const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require('../auth/authMiddleware');

router.get('/invoices/group/:groupId', authMiddleware, async (req, res) => {
    console.log('=== Get Invoices by Group Request ===');
    try {
        const { groupId } = req.params;

    
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

router.patch('/invoices/:invoiceId/records/:recordId', authMiddleware, async (req, res) => {
    console.log('=== Update Record Payment Status Request ===');
    try {
        const { invoiceId, recordId } = req.params;
        const { is_paid } = req.body;

    
        await pool.query(
            'UPDATE record SET already_paid = ? WHERE invoice_id = ? AND record_id = ?',
            [is_paid, invoiceId, recordId]
        );

        res.json({ message: 'Payment status updated successfully' });
    } catch (error) {
        console.error('Error in PATCH /invoices/records:', error);
        res.status(500).json({ error: 'Failed to update payment status' });
    }
});

module.exports = router; 