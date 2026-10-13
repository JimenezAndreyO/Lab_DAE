var express = require('express');
var router = express.Router();

/* GET home page: el calendario */
router.get('/', function (req, res, next) {
  res.render('Calendario');
});

module.exports = router;