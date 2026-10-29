const express = require('express');
const { metrics } = require('../controllers/metricsController');

const router = express.Router();

router.get('/', metrics);

module.exports = router;
