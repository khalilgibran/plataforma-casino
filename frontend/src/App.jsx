import { useState, useEffect } from 'react'
import io from 'socket.io-client'
import './App.css'

// Conecta ao servidor Socket
const socket = io('http://localhost:3000');

function App() {
  // --- ESTADOS GERAIS ---
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(null)
  const [history, setHistory] = useState([])

  // Navegação: 'menu', 'crash', 'coinflip', 'admin'
  const [gameMode, setGameMode] = useState('menu')

  // Admin
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminStats, setAdminStats] = useState(null)
  const [userList, setUserList] = useState([])

  // Login
  const [isLogin, setIsLogin] = useState(true)
  const [formData, setFormData] = useState({ email: '', password: '', username: '' })

  // Notificações (Multiplayer)
  const [liveEvents, setLiveEvents] = useState([])

  // --- ESTADOS DOS JOGOS ---
  const [betAmount, setBetAmount] = useState(10)
  const [isPlaying, setIsPlaying] = useState(false)
  const [result, setResult] = useState(null)

  // Crash Específico
  const [target, setTarget] = useState(2.00)
  const [crashDisplay, setCrashDisplay] = useState(1.00)

  // Coinflip Específico
  const [coinSide, setCoinSide] = useState('')

  // --- EFEITOS (Ouvintes) ---

  useEffect(() => {
    // Ouve vitórias de outros jogadores
    socket.on('big_win', (data) => {
      setLiveEvents((prev) => [data, ...prev].slice(0, 3));
    });
    return () => socket.off('big_win');
  }, []);

  useEffect(() => {
    if (token) {
      refreshUser();
      refreshHistory();
    }
  }, [token])

  // --- FUNÇÕES DE CARREGAMENTO ---

  const refreshUser = async () => {
    try {
      const res = await fetch('http://localhost:3000/me', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        // Verifica se é admin tentando acessar a rota de stats
        checkAdmin();
      } else logout();
    } catch { logout(); }
  }

  const checkAdmin = async () => {
    try {
      const res = await fetch('http://localhost:3000/admin/stats', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        setIsAdmin(true);
        setAdminStats(await res.json());
        loadUserList();
      }
    } catch { }
  }

  const loadUserList = async () => {
    const res = await fetch('http://localhost:3000/admin/users', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) setUserList(await res.json());
  }

  const refreshHistory = async () => {
    try {
      const res = await fetch('http://localhost:3000/my-history', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setHistory(await res.json());
    } catch { }
  }

  const logout = () => { localStorage.removeItem('token'); setToken(null); setUser(null); setIsAdmin(false); }

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = isLogin ? '/login' : '/register';
    const res = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.token) { localStorage.setItem('token', data.token); setToken(data.token); } else { alert(data.message); }
  }

  const giveBonus = async (userId) => {
    const amount = prompt("Valor do Bônus:");
    if (!amount) return;
    await fetch('http://localhost:3000/admin/give-money', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, amount })
    });
    alert('Enviado!');
    loadUserList();
  }

  // --- LÓGICA: CRASH ---
  const playCrash = async () => {
    setResult(null); setIsPlaying(true); setCrashDisplay(1.00);
    try {
      const res = await fetch('http://localhost:3000/game/crash', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ betAmount: Number(betAmount), autoCashout: Number(target) })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message); setIsPlaying(false); return; }

      let current = 1.00;
      const final = parseFloat(data.crashPoint);
      const step = final / 50;

      const timer = setInterval(() => {
        current += step;
        if (current >= final) {
          clearInterval(timer);
          setCrashDisplay(final);
          setIsPlaying(false);
          setResult(data);
          setUser(u => ({ ...u, balance: data.newBalance }));
          refreshHistory();
        } else { setCrashDisplay(current); }
      }, 30);
    } catch (err) { setIsPlaying(false); alert('Erro'); }
  }

  // --- LÓGICA: COINFLIP ---
  const playCoinflip = async (choice) => {
    setResult(null); setIsPlaying(true); setCoinSide('');

    setTimeout(async () => {
      try {
        const res = await fetch('http://localhost:3000/game/coinflip', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ betAmount: Number(betAmount), choice })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.message); setIsPlaying(false); return; }

        // Aplica a classe CSS para girar
        setCoinSide(data.result === 'cara' ? 'spin-heads' : 'spin-tails');

        // Espera a animação de 3s
        setTimeout(() => {
          setIsPlaying(false);
          setResult(data);
          setUser(u => ({ ...u, balance: data.newBalance }));
          refreshHistory();
        }, 3000);
      } catch (err) { setIsPlaying(false); alert('Erro'); }
    }, 100);
  }

  // --- RENDERIZAÇÃO ---

  if (!user) return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="logo">ANTIGRAVITY</h1>
        <form onSubmit={handleAuth}>
          {!isLogin && <input type="text" placeholder="Nome" onChange={e => setFormData({ ...formData, username: e.target.value })} />}
          <input type="email" placeholder="Email" onChange={e => setFormData({ ...formData, email: e.target.value })} />
          <input type="password" placeholder="Senha" onChange={e => setFormData({ ...formData, password: e.target.value })} />
          <button type="submit">{isLogin ? 'ENTRAR' : 'CADASTRAR'}</button>
        </form>
        <p onClick={() => setIsLogin(!isLogin)} style={{ cursor: 'pointer', marginTop: '20px', color: '#999' }}>{isLogin ? 'Criar conta' : 'Já tenho conta'}</p>
      </div>
    </div>
  )

  return (
    <div className="app-container">
      {/* Feed Multiplayer */}
      {liveEvents.length > 0 && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 1000 }}>
          {liveEvents.map((ev, i) => (
            <div key={i} style={{ background: 'rgba(0,0,0,0.9)', border: '1px solid #00e5ff', color: '#00e5ff', padding: '10px', marginBottom: '5px', borderRadius: '8px', animation: 'fadeIn 0.5s' }}>
              🔥 <b>@{ev.username}</b> ganhou <b>R$ {parseFloat(ev.profit).toFixed(2)}</b> no {ev.game}!
            </div>
          ))}
        </div>
      )}

      <nav className="navbar">
        <div className="logo" onClick={() => setGameMode('menu')} style={{ cursor: 'pointer' }}>🎰 ANTIGRAVITY</div>
        <div className="user-info">
          <div className="balance-box">R$ {parseFloat(user.balance).toFixed(2)}</div>
          <button onClick={logout} className="btn-logout">Sair</button>
        </div>
      </nav>

      {/* MENU PRINCIPAL */}
      {gameMode === 'menu' && (
        <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '100px', flexWrap: 'wrap' }}>
          <div onClick={() => setGameMode('crash')} className="game-card" style={{ background: 'var(--card-bg)', padding: '40px', borderRadius: '20px', border: '1px solid #333', cursor: 'pointer', textAlign: 'center', width: '200px' }}>
            <div style={{ fontSize: '50px' }}>🚀</div>
            <h2>Crash</h2>
          </div>
          <div onClick={() => setGameMode('coinflip')} className="game-card" style={{ background: 'var(--card-bg)', padding: '40px', borderRadius: '20px', border: '1px solid #333', cursor: 'pointer', textAlign: 'center', width: '200px' }}>
            <div style={{ fontSize: '50px' }}>🪙</div>
            <h2>Coinflip</h2>
          </div>
          {isAdmin && (
            <div onClick={() => setGameMode('admin')} className="game-card" style={{ background: '#2c3e50', padding: '40px', borderRadius: '20px', border: '1px solid #333', cursor: 'pointer', textAlign: 'center', width: '200px' }}>
              <div style={{ fontSize: '50px' }}>👮‍♂️</div>
              <h2>Admin</h2>
            </div>
          )}
        </div>
      )}

      {/* JOGO CRASH */}
      {gameMode === 'crash' && (
        <div className="game-area">
          <button onClick={() => setGameMode('menu')} style={{ float: 'left', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>⬅ Voltar</button>
          <div className={`multiplier-display ${isPlaying ? 'color-orange' : (result?.isWin ? 'color-green' : (result ? 'color-red' : 'color-white'))}`}>
            {crashDisplay.toFixed(2)}x
          </div>
          {result && !isPlaying && <h3 style={{ color: result.isWin ? '#2cb67d' : '#ef4565' }}>{result.isWin ? `VITÓRIA: + R$ ${result.profit.toFixed(2)}` : 'CRASH!'}</h3>}
          <div className="controls">
            <div className="input-group"><label>Aposta</label><input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} /></div>
            <div className="input-group"><label>Auto (x)</label><input type="number" value={target} onChange={e => setTarget(e.target.value)} /></div>
            <button onClick={playCrash} disabled={isPlaying} className="btn-action btn-bet">{isPlaying ? '...' : 'JOGAR'}</button>
          </div>
        </div>
      )}

      {/* JOGO COINFLIP */}
      {gameMode === 'coinflip' && (
        <div className="game-area">
          <button onClick={() => setGameMode('menu')} style={{ float: 'left', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>⬅ Voltar</button>
          <div className="coin-container">
            <div className={`coin ${coinSide}`}>
              <div className="coin-face heads">CARA</div>
              <div className="coin-face tails">COROA</div>
            </div>
          </div>
          {result && !isPlaying && <h3 style={{ marginTop: '30px', color: result.isWin ? '#2cb67d' : '#ef4565' }}>{result.isWin ? `VITÓRIA! + R$ ${result.profit.toFixed(2)}` : 'DERROTA'}</h3>}
          <div className="controls" style={{ marginTop: '50px' }}>
            <div className="input-group"><label>Aposta</label><input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} /></div>
            <button onClick={() => playCoinflip('cara')} disabled={isPlaying} className="btn-action" style={{ background: '#ffd700', color: 'black', marginBottom: '10px' }}>🙂 CARA</button>
            <button onClick={() => playCoinflip('coroa')} disabled={isPlaying} className="btn-action" style={{ background: '#c0c0c0', color: 'black' }}>👑 COROA</button>
          </div>
        </div>
      )}

      {/* PAINEL ADMIN */}
      {gameMode === 'admin' && isAdmin && adminStats && (
        <div className="game-area" style={{ textAlign: 'left' }}>
          <button onClick={() => setGameMode('menu')} style={{ marginBottom: '20px', background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer' }}>⬅ Menu</button>
          <h1>Painel da Diretoria</h1>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '40px', flexWrap: 'wrap' }}>
            <div style={{ background: '#16161a', padding: '20px', borderRadius: '10px', flex: 1, minWidth: '150px' }}>
              <h3>Lucro da Casa</h3>
              <h2 style={{ color: adminStats.profit >= 0 ? '#2cb67d' : '#ef4565' }}>R$ {adminStats.profit}</h2>
            </div>
            <div style={{ background: '#16161a', padding: '20px', borderRadius: '10px', flex: 1, minWidth: '150px' }}>
              <h3>Jogadores</h3>
              <h2>{adminStats.users}</h2>
            </div>
            <div style={{ background: '#16161a', padding: '20px', borderRadius: '10px', flex: 1, minWidth: '150px' }}>
              <h3>Jogos</h3>
              <h2>{adminStats.games}</h2>
            </div>
          </div>
          <h3>Gerenciar Usuários</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="history-table">
              <thead><tr><th>ID</th><th>User</th><th>Saldo</th><th>Ação</th></tr></thead>
              <tbody>
                {userList.map(u => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.username} {u.is_admin ? '👑' : ''}</td>
                    <td>R$ {parseFloat(u.balance).toFixed(2)}</td>
                    <td>
                      <button onClick={() => giveBonus(u.id)} style={{ background: '#2ecc71', border: 'none', padding: '5px 10px', borderRadius: '5px', color: 'white', cursor: 'pointer' }}>+ Bônus</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HISTÓRICO GLOBAL */}
      {gameMode !== 'menu' && gameMode !== 'admin' && (
        <div className="history-section">
          <table className="history-table">
            <thead><tr><th>Jogo</th><th>Aposta</th><th>Lucro</th></tr></thead>
            <tbody>
              {history.map(g => (
                <tr key={g.id}>
                  <td>{g.game ? g.game.toUpperCase() : '-'}</td>
                  <td>R$ {parseFloat(g.bet).toFixed(2)}</td>
                  <td style={{ color: g.profit > 0 ? 'green' : 'red' }}>{g.profit > 0 ? '+' : ''}{parseFloat(g.profit).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default App