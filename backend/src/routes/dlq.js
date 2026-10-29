const express = require('express');
const { listDeadLetters, replay } = require('../controllers/dlqController');

const router = express.Router();

router.get('/', listDeadLetters);
router.post('/:deadLetterId/replay', replay);

module.exports = router;
