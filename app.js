// Ruta explícita al .env: en IIS el directorio de trabajo puede no ser el de la app
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var Calendario = require('./routes/Calendario');
var Reservas = require('./routes/Reservas');
var Enviosemanal = require('./routes/Enviosemanal');
// Nota: Almacen.js NO se monta como ruta; solo lo usan Reservas y Enviosemanal.

console.log('indexRouter:', typeof indexRouter);
console.log('usersRouter:', typeof usersRouter);
console.log('Calendario:', typeof Calendario);

var app = express();

// Configuración del motor de vistas Pug
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Middlewares
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// Desactivado mientras terminamos el código (sirve archivos de public/ y puede tapar la vista nueva).
// app.use(express.static(path.join(__dirname, 'public')));

// Rutas
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/Calendario', Calendario);
app.use('/api/reservas', Reservas); // la vista llama a esta ruta para guardar/leer bloques

// Correo semanal automático
Enviosemanal.iniciar();

// Error 404: página no encontrada
app.use(function(req, res, next) {
  next(createError(404));
});

// Manejador de errores
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;