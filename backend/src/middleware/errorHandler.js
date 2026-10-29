/**
 * Centralized error handler. Anything an individual controller didn't
 * already turn into a clean 4xx response lands here.
 */
module.exports = function errorHandler(err, req, res, _next) {
  // A malformed ObjectId (e.g. a bad /dlq/:id path param) throws a Mongoose
  // CastError -- treat it the same as "not found" rather than a 500.
  if (err.name === 'CastError') {
    return res.status(404).json({ detail: 'resource not found' });
  }

  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ detail: 'malformed JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ detail: 'request body too large' });
  }

  console.error('[error]', err);
  return res.status(500).json({ detail: 'internal server error' });
};
