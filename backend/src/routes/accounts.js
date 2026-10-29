const express = require('express');
const { createAccount, getAccount, getAuditLog } = require('../controllers/accountController');
const { createTransaction } = require('../controllers/transactionController');

const router = express.Router();

router.post('/', createAccount);
router.get('/:accountId', getAccount);
router.post('/:accountId/transactions', createTransaction);
router.get('/:accountId/audit-log', getAuditLog);

module.exports = router;
