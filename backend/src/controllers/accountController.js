const { v4: uuidv4 } = require('uuid');
const Account = require('../models/Account');
const AuditLog = require('../models/AuditLog');

function toAccountOut(account) {
  return {
    id: account._id,
    name: account.name,
    balance: account.balance,
    version: account.version,
  };
}

async function createAccount(req, res, next) {
  try {
    const { name, opening_balance: openingBalanceRaw } = req.body || {};

    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 120) {
      return res.status(422).json({ detail: 'name must be a string between 1 and 120 characters' });
    }

    const openingBalance = openingBalanceRaw === undefined ? 0 : openingBalanceRaw;
    if (typeof openingBalance !== 'number' || Number.isNaN(openingBalance) || openingBalance < 0) {
      return res.status(422).json({ detail: 'opening_balance must be a number >= 0' });
    }

    const account = await Account.create({
      _id: uuidv4(),
      name,
      balance: openingBalance,
      version: 0,
      lastSequence: 0,
    });

    return res.status(201).json(toAccountOut(account));
  } catch (err) {
    return next(err);
  }
}

async function getAccount(req, res, next) {
  try {
    const account = await Account.findById(req.params.accountId);
    if (!account) return res.status(404).json({ detail: 'account not found' });
    return res.status(200).json(toAccountOut(account));
  } catch (err) {
    return next(err);
  }
}

async function getAuditLog(req, res, next) {
  try {
    const rows = await AuditLog.find({ accountId: req.params.accountId }).sort({ sequence: 1 });
    return res.status(200).json(
      rows.map((r) => ({
        event_id: r.eventId,
        event_type: r.eventType,
        amount: r.amount,
        sequence: r.sequence,
        balance_after_event: r.balanceAfterEvent,
      }))
    );
  } catch (err) {
    return next(err);
  }
}

module.exports = { createAccount, getAccount, getAuditLog, toAccountOut };
