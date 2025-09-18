const mysql = require('mysql2');

const pool = mysql.createPool({
    host: process.env.DB_HOST,       // Aquí irá la IP de tu servidor Hostinger
    user: process.env.DB_USER,       // Tu usuario de la base de datos
    password: process.env.DB_PASSWORD, // Tu contraseña
    database: process.env.DB_NAME    // El nombre de tu base de datos
});

module.exports = pool.promise();