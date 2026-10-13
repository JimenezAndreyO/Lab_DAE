const express = require('express');
const router = express.Router();

// También se puede entrar por /Calendario
router.get('/', function (req, res) {
  res.render('calendario');
});

module.exports = router;