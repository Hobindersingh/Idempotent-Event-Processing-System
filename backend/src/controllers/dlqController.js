const DeadLetter = require('../models/DeadLetter');
const { replayDeadLetter } = require('../services/consumer');

async function listDeadLetters(req, res, next) {
  try {
    const rows = await DeadLetter.find({ resolved: false }).sort({ createdAt: 1 });
    return res.status(200).json(
      rows.map((r) => ({
        id: r._id,
        event_id: r.eventId,
        account_id: r.accountId,
        error: r.error,
        attempts: r.attempts,
      }))
    );
  } catch (err) {
    return next(err);
  }
}

async function replay(req, res, next) {
  try {
    const result = await replayDeadLetter(req.params.deadLetterId);
    return res.status(200).json({ status: result.status, event_id: result.eventId, detail: result.detail });
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.name === 'CastError') {
      return res.status(404).json({ detail: `no dead letter with id ${req.params.deadLetterId}` });
    }
    return next(err);
  }
}

module.exports = { listDeadLetters, replay };
