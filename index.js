const express = require('express');
const cors = require('cors');
const pool = require('./db'); // conexión a BD
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

// Crear servidor HTTP y Socket.IO con CORS habilitado
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // O especifica tu dominio frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutos
    skipMiddlewares: true
  }
});

// Socket.IO: manejar conexiones
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Obtener todos los usuarios (incluye admin)
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

// Obtener usuarios delivery (sin admin)
app.get('/users-delivery', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE username != $1', ['admin']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

// Login usuario
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const query = 'SELECT * FROM users WHERE username = $1 AND password = $2';
    const result = await pool.query(query, [username, password]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

// Obtener todas las ubicaciones con usuario y estado
app.get('/location', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT users.id as user_id, users.username, delivery_status.last_lat, delivery_status.last_lng, delivery_status.status
      FROM delivery_status
      INNER JOIN users ON delivery_status.user_id = users.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar ubicación' });
  }
});

// Obtener última ubicación por usuario (distintas por user_id ordenadas por fecha desc)
app.get('/location-latest', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (user_id) user_id, last_lat, last_lng, status, last_update
      FROM delivery_status
      ORDER BY user_id, last_update DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar última ubicación' });
  }
});

// Función para actualizar o insertar ubicación del delivery y emitir evento socket
async function actualizarUbicacionDelivery(userId, lat, lng, status) {
  try {
    const updateQuery = `
      UPDATE delivery_status 
      SET last_lat = $1, last_lng = $2, status = $3, last_update = NOW() 
      WHERE user_id = $4 
      RETURNING *`;
    
    const updateResult = await pool.query(updateQuery, [lat, lng, status, userId]);

    if (updateResult.rowCount === 0) {
      const insertQuery = `
        INSERT INTO delivery_status (user_id, last_lat, last_lng, status, last_update)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *`;
      const insertResult = await pool.query(insertQuery, [userId, lat, lng, status]);
      return insertResult.rows[0];
    }
    
    const updatedLocation = updateResult.rows[0];
    io.emit('ubicaciones-actualizadas', [updatedLocation]);
    return updatedLocation;
  } catch (err) {
    console.error('Error en actualizarUbicacionDelivery:', err);
    throw err;
  }
}

// Endpoint para actualizar ubicación del delivery
app.post('/update-location', async (req, res) => {
  const { user_id, last_lat, last_lng, status } = req.body;
  
  if (!user_id || !last_lat || !last_lng) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    const updatedLocation = await actualizarUbicacionDelivery(
      user_id,
      parseFloat(last_lat),
      parseFloat(last_lng),
      status || 'En transito'
    );
    
    const allLocations = await pool.query(`
      SELECT users.id as user_id, users.username, delivery_status.last_lat, delivery_status.last_lng, delivery_status.status
      FROM delivery_status
      INNER JOIN users ON delivery_status.user_id = users.id
    `);
    io.emit('ubicaciones-actualizadas', allLocations.rows);

    res.status(200).json(updatedLocation);
  } catch (err) {
    console.error('Error completo en update-location:', {
      error: err,
      stack: err.stack,
      body: req.body
    });
    
    res.status(500).json({ 
      error: 'Error en servidor al actualizar ubicación',
      details: err.message 
    });
  }
});

// Obtener última ubicación por usuario específico
app.get('/location-latest/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query(`
      SELECT * FROM delivery_status 
      WHERE user_id = $1 
      ORDER BY last_update DESC 
      LIMIT 1
    `, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ubicación no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar ubicación' });
  }
});

// Emitir ubicaciones actualizadas cada 10 segundos
setInterval(async () => {
  try {
    const result = await pool.query(`SELECT 
      users.id as user_id, 
      users.username, 
      delivery_status.last_lat, 
      delivery_status.last_lng, 
      delivery_status.status,
      delivery_status.last_update
      FROM delivery_status
      INNER JOIN users ON delivery_status.user_id = users.id
      ORDER BY last_update DESC
    `);
    io.emit('ubicaciones-actualizadas', result.rows);
  } catch (err) {
    console.error('Error al emitir ubicaciones:', err);
  }
}, 10000); // 10 segundos

// Paquetes: obtener todos
app.get('/paquetes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM packages');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar paquetes' });
  }
});

// Paquetes filtrados por status y assigned_to (opcional)
app.get('/paquetesUs', async (req, res) => {
  const { status, assigned_to } = req.query;

  let query = 'SELECT * FROM packages WHERE 1=1';
  const params = [];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (assigned_to) {
    params.push(assigned_to);
    query += ` AND assigned_to = $${params.length}`;
  }

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener paquetes' });
  }
});

// Agregar paquete nuevo 
app.post('/add-package', async (req, res) => {
  const { delivery_address, delivery_lat, delivery_lng, assigned_to, status, created_at } = req.body;
    console.log('Solicitud POST a /add-package recibida. Body:', req.body);
  try {
    const newPackageQuery = `
      INSERT INTO packages (delivery_address, delivery_lat, delivery_lng, assigned_to, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const result = await pool.query(newPackageQuery, [delivery_address, delivery_lat, delivery_lng, assigned_to, status, created_at]);
    
    const newPackage = result.rows[0];
    io.emit('paquete-asignado', newPackage);
    
    res.status(201).json(newPackage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar paquete' });
  }
});

// Obtener paquetes asignados a un usuario
app.get('/packages/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  try {
    const result = await pool.query(
      'SELECT * FROM packages WHERE assigned_to = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar estado de paquete
app.patch('/packages/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  try {
    const result = await pool.query(
      'UPDATE packages SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Paquete no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar paquete' });
  }
});


app.patch('/update-status/:id', async (req, res) => {
  console.log('Solicitud PATCH a /update-status recibida.');
  const userId = req.params.id; // 💡 Obtiene el ID del parámetro de la URL
  const { status } = req.body; 

  if (!userId || !status) {
    console.error('Error: Faltan datos obligatorios');
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    const result = await pool.query(
      'UPDATE delivery_status SET status = $1, last_update = NOW() WHERE user_id = $2 RETURNING *',
      [status, userId]
    );
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar el estado del repartidor:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Iniciar servidor
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});