const express = require('express');
const cors = require('cors');
const pool = require('./db'); // archivo de conexión
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Rutas
app.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

app.get('/users-delivery', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE username != $1', ['admin']);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const query = 'SELECT * FROM users WHERE username = $1 AND password = $2';
    const values = [username, password];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});

app.get('/location', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM delivery_status INNER JOIN users ON delivery_status.user_id = users.id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar ubicación' });
  }
});

app.post('/add-location', async (req, res) => {
  const { user_id, status, last_lat, last_lng } = req.body;
  try {
    const query = `
      INSERT INTO delivery_status (user_id, status, last_lat, last_lng, location)
      VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326))
      RETURNING *;
    `;
    const values = [user_id, status, last_lat, last_lng];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No se pudo insertar la ubicación' });
    }

    const newLocation = result.rows[0];

    // Emitir a todos los clientes conectados
    io.emit('nueva-ubicacion', {
      id: newLocation.user_id,
      lat: newLocation.last_lat,
      lng: newLocation.last_lng,
      status: newLocation.status,
    });

    res.status(201).json(newLocation);
  } catch (err) {
    console.error('Error al insertar ubicación:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

app.get('/paquetes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM packages');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar usuarios' });
  }
});


// Backend (Node.js/Express)
app.patch('/paquetes/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user.id; // ID del usuario autenticado

  try {
    const result = await pool.query(
      `UPDATE packages 
       SET status = $1 
       WHERE id = $2 AND assigned_to = $3
       RETURNING *`,
      [status, id, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paquete no encontrado o no asignado a este usuario' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el paquete' });
  }
});



app.post('/add-package', async (req, res) => {
  const { delivery_address, status, assigned_to, created_at } = req.body;

  try {
    const query = `
      INSERT INTO packages (delivery_address, status, assigned_to, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const values = [delivery_address, status, assigned_to, created_at];
    const result = await pool.query(query, values);

    // Devuelve el paquete insertado
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al insertar paquete:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});


// Iniciar servidor
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
