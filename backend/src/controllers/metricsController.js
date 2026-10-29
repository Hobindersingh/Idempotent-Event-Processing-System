const Account = require('../models/Account');
const Outbox = require('../models/Outbox');
const ProcessedEvent = require('../models/ProcessedEvent');
const DeadLetter = require('../models/DeadLetter');
const AuditLog = require('../models/AuditLog');

async function metrics(req, res, next) {
  try {
    const [accounts, outboxUnpublished, outboxTotal, processedEvents, deadLettersUnresolved, auditLogEntries] =
      await Promise.all([
        Account.countDocuments(),
        Outbox.countDocuments({ published: false }),
        Outbox.countDocuments(),
        ProcessedEvent.countDocuments(),
        DeadLetter.countDocuments({ resolved: false }),
        AuditLog.countDocuments(),
      ]);

    return res.status(200).json({
      accounts,
      outbox_unpublished: outboxUnpublished,
      outbox_total: outboxTotal,
      processed_events: processedEvents,
      dead_letters_unresolved: deadLettersUnresolved,
      audit_log_entries: auditLogEntries,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { metrics };
