const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = 'minha_chave_super_secreta_e_segura'; // Em produção, use process.env

// --- CONFIGURAÇÃO DO SOCKET.IO E SERVIDOR ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // URL do Frontend
        methods: ["GET", "POST"]
    }
});

// --- CONEXÃO COM O BANCO DE DADOS ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.use(cors());
app.use(express.json());

// --- MIDDLEWARES DE SEGURANÇA ---

// 1. Verifica se o usuário está logado
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Acesso negado' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token inválido' });
        req.user = user;
        next();
    });
}

// 2. Verifica se o usuário é ADMIN (Diretoria)
function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id])
            .then(result => {
                if (result.rows.length > 0 && result.rows[0].is_admin === 1) {
                    next(); // É patrão, pode passar.
                } else {
                    res.status(403).json({ message: 'Acesso restrito à Diretoria.' });
                }
            })
            .catch(err => res.status(500).json({ message: 'Erro ao verificar permissão' }));
    });
}

// --- EVENTOS DO SOCKET ---
io.on('connection', (socket) => {
    console.log('🔌 Jogador conectado:', socket.id);
});

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Email ou senha incorretos' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });

        // Retorna dados seguros do usuário
        res.json({
            message: 'Login realizado',
            token,
            user: { id: user.id, username: user.username, balance: user.balance }
        });
    } catch (err) { res.status(500).json({ message: 'Erro no servidor' }); }
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) return res.status(400).json({ message: 'Email já existe' });

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // Cria usuário com R$ 1000 de bônus inicial
        const newUser = await pool.query(
            `INSERT INTO users (username, email, password, balance) VALUES ($1, $2, $3, 1000.00) RETURNING id, username, balance`,
            [username, email, hash]
        );
        res.json({ message: 'Conta criada!', user: newUser.rows[0] });
    } catch (err) { res.status(500).json({ message: 'Erro ao cadastrar' }); }
});

// --- ROTAS DE DADOS DO USUÁRIO ---

app.get('/me', authenticateToken, async (req, res) => {
    // Busca dados atualizados do usuário
    const result = await pool.query('SELECT id, username, balance, is_admin FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
});

app.get('/my-history', authenticateToken, async (req, res) => {
    try {
        const history = await pool.query('SELECT * FROM game_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
        res.json(history.rows);
    } catch (err) { res.status(500).json({ message: 'Erro ao buscar histórico' }); }
});

// --- ROTAS DE JOGOS ---

// Jogo 1: Crash (Aviãozinho)
app.post('/game/crash', authenticateToken, async (req, res) => {
    const { betAmount, autoCashout } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
        const balance = parseFloat(userRes.rows[0].balance);

        if (balance < betAmount || betAmount <= 0) return res.status(400).json({ message: 'Saldo insuficiente' });

        // Lógica do Crash (Pareto Inverso)
        let crashPoint = 0.99 / (1 - Math.random());
        crashPoint = Math.floor(crashPoint * 100) / 100;
        if (crashPoint < 1) crashPoint = 1.00;

        const isWin = crashPoint >= autoCashout;

        let profit = 0;
        let newBalance = balance;

        if (isWin) {
            profit = (betAmount * autoCashout) - betAmount;
            newBalance = balance + profit;
        } else {
            profit = -parseFloat(betAmount);
            newBalance = balance - parseFloat(betAmount);
        }

        // Atualiza Banco e Histórico
        await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
        await pool.query(
            'INSERT INTO game_history (user_id, game, bet, multiplier, profit, result) VALUES ($1, $2, $3, $4, $5, $6)',
            [userId, 'crash', betAmount, crashPoint, profit, isWin ? 'win' : 'loss']
        );

        // Notifica todos se for uma vitória
        if (isWin) {
            io.emit('big_win', { username, profit, multiplier: autoCashout, game: 'Crash' });
        }

        res.json({ crashPoint, userTarget: autoCashout, isWin, profit, newBalance });

    } catch (err) { res.status(500).json({ message: 'Erro no jogo Crash' }); }
});

// Jogo 2: Coinflip (Cara ou Coroa)
app.post('/game/coinflip', authenticateToken, async (req, res) => {
    const { betAmount, choice } = req.body; // choice: 'cara' ou 'coroa'
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
        const balance = parseFloat(userRes.rows[0].balance);

        if (balance < betAmount || betAmount <= 0) return res.status(400).json({ message: 'Saldo insuficiente' });

        const result = Math.random() < 0.5 ? 'cara' : 'coroa';
        const isWin = choice === result;

        const profit = isWin ? parseFloat(betAmount) : -parseFloat(betAmount);
        const newBalance = balance + profit;

        await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
        await pool.query(
            'INSERT INTO game_history (user_id, game, bet, profit, result) VALUES ($1, $2, $3, $4, $5)',
            [userId, 'coinflip', betAmount, profit, isWin ? 'win' : 'loss']
        );

        if (isWin) {
            io.emit('big_win', { username, profit, game: 'Coinflip' });
        }

        res.json({ result, isWin, newBalance, profit });

    } catch (err) { res.status(500).json({ message: 'Erro no Coinflip' }); }
});

// --- ROTAS DE ADMINISTRAÇÃO (PAINEL DO DONO) ---

app.get('/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const usersCount = await pool.query('SELECT COUNT(*) FROM users');
        const gamesCount = await pool.query('SELECT COUNT(*) FROM game_history');

        // Lucro da Casa = (Perdas dos usuários) - (Ganhos dos usuários)
        // Profit < 0 no histórico significa perda do usuário (lucro pra casa)
        const houseProfit = await pool.query('SELECT SUM(profit) * -1 as total FROM game_history WHERE profit < 0');
        const houseLoss = await pool.query('SELECT SUM(profit) FROM game_history WHERE profit > 0');

        const totalProfit = (parseFloat(houseProfit.rows[0].total || 0) - parseFloat(houseLoss.rows[0].total || 0));

        res.json({
            users: usersCount.rows[0].count,
            games: gamesCount.rows[0].count,
            profit: totalProfit.toFixed(2)
        });
    } catch (err) { res.status(500).json({ message: 'Erro Admin Stats' }); }
});

app.get('/admin/users', authenticateAdmin, async (req, res) => {
    const result = await pool.query('SELECT id, username, email, balance, is_admin FROM users ORDER BY id ASC');
    res.json(result.rows);
});

app.post('/admin/give-money', authenticateAdmin, async (req, res) => {
    const { userId, amount } = req.body;
    try {
        await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, userId]);
        res.json({ message: `Enviado R$ ${amount} para o usuário ID ${userId}` });
    } catch (err) { res.status(500).json({ message: 'Erro ao dar bônus' }); }
});

// --- INICIALIZAÇÃO ---
server.listen(port, () => {
    console.log(`🚀 Servidor Socket+Express rodando na porta ${port}`);
});