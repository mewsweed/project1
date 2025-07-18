const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;
const session = require('express-session');
const { create } = require('domain');
const db = new sqlite3.Database('project.db');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session setup
app.use(session({
    secret: 'your-secret-key',  // ควรใช้ค่าสุ่มที่ปลอดภัย
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 // 1 ชั่วโมง
    }
}));
// Database setup
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS user_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        address TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount INTEGER,
        category TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});
// Helper function to get current timestamp in Thai timezone
// (UTC+7)
function getThaiTimestamp() {
    const date = new Date();
    date.setHours(date.getHours() + 7); // เพิ่ม 7 ชั่วโมง
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Routes
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'Home',
        message: 'Welcome to your first website!',
        user: req.session.user || null
    });
});
app.get('/login', (req, res) => {
    res.render('login', { 
        title: 'Login',
        message: null,
        user: req.session.user || null
    });
});
app.get('/register', (req, res) => {
    res.render('register', { 
        title: 'Register',
        message: null,
        user: req.session.user || null
    });
});
app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userID = req.session.user.id;
  const range = req.query.range || 'month'; // ✅ ย้ายมาด้านบน
  const now = new Date();
  let startDate;

  if (range === 'day') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === 'week') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - now.getDay());
  } else if (range === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (range === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const isoStartDate = startDate.toISOString().split('T')[0];
  
  db.all(
    `SELECT type, SUM(amount) AS total
     FROM transactions
     WHERE user_id = ? AND DATE(created_at) >= DATE(?)
     GROUP BY type`,
    [userID, isoStartDate],
    (err, results) => {
      if (err) {
        console.error('❌ SQL Error:', err.message); // ← ดูตรงนี้
        return res.status(500).send('Error loading Dashboard');
        }

      const dashboard = { income: 0, expense: 0 };
      results.forEach(row => {
        if (row.type === 'income') dashboard.income = row.total;
        if (row.type === 'expense') dashboard.expense = row.total;
      });

      res.render('dashboard', {
        title: 'Dashboard',
        user: req.session.user,
        dashboard,
        range  // ✅ ตอนนี้ใช้งานได้แล้ว
      });
    }
  );
});

app.get('/transactions', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const userID = req.session.user.id;
    db.all(`SELECT * FROM transactions WHERE user_id = ?`, [userID], (err, transactions) => {
        if (err) {
            return res.status(500).send('Error loading transactions table');
        }
        return res.render('transactions', {
            title: 'Transactions',
            user: req.session.user,
            message: null,
            transactions: transactions || []
        });
    });
});

app.get('/reports', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    // Here you would typically fetch reports from the database
    res.render('reports', {
        title: 'Reports',
        user: req.session.user,
        reports: [] // Placeholder for reports
    });
});
app.get('/goals', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    // Here you would typically fetch goals from the database
    res.render('goals', {
        title: 'Goals',
        user: req.session.user,
        goals: [] // Placeholder for goals
    });
});
app.get('/profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    db.get(`SELECT * FROM user_info WHERE user_id = ?`, [req.session.user.id], (err, userInfo) => {
        if (err) {
            return res.status(500).send('Error fetching user info');
        }
        res.render('profile', {
            title: 'Profile',
            user: req.session.user,
            userInfo: userInfo || {},
            message: null
        });
    });
});

//===================================================== OPERATION ================================================================================================================
app.post('/register', (req, res) => {
    const { email, password, password2 } = req.body;
    if (!email || !password) {
        return res.render('register', {
            title: 'Register',
            message: 'Email and password are required'
        });
    }
    if (password !== password2) {
        return res.render('register', {
            title: 'Register',
            message: 'Passwords do not match'
        });
    }
    // Check if user already exists
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err) {
            return res.status(500).send('Error checking user');
        }
        if (user) {
            return res.render('register', {
                title: 'Register',
                message: 'User already exists'
            });
        }
        // Insert new user
        db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, password], function(err) {
            if (err) {
                return res.status(500).send('Error registering user');
            }
            const userId = this.lastID;
            // Create user info entry
            const createdAt = getThaiTimestamp();
            db.run(`INSERT INTO user_info (user_id, first_name, last_name, phone, address) VALUES (?, '', '', '', '')`, [userId], function(err) {
                if (err) {
                    return res.status(500).send('Error creating user info');
                }
                res.redirect('/login');
            });
        });
    });
});
app.post('/login', (req, res) => {
    const {email, password} = req.body;
    if (!email || !password) {
        return res.render('login', {
            title: 'Login',
            message: 'Email and password are required'
        });
    }
    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err) {
            return res.status(500).send('Error logging in');
        }
        if (!user) {
            return res.render('login', {
                title: 'Login',
                message: 'Invalid email or password'
            });
        }
        // Update last login time
        const lastLogin = getThaiTimestamp();
        db.run(`UPDATE users SET last_login = ? WHERE id = ?`, [lastLogin, user.id], (err) => {
            if (err) {
                return res.status(500).send('Error updating last login');
            }
            db.get(`SELECT * FROM users WHERE id = ?`, [user.id], (err, user) => {
                if (err) {
                    return res.status(500).send('Error fetching user info');
                }
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    last_Login: user.last_login,
                    created_at: user.created_at
                };
                res.redirect('/dashboard');
            });
        });
        
    });
});
    
app.post('/profile', (req, res) => {                
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const { first_name, last_name, phone, address } = req.body;
    const userId = req.session.user.id;
    db.get(`SELECT * FROM user_info WHERE user_id = ?`, [userId], (err, userInfo) => {      // GET USER DATA
        if (err) {
            return res.status(500).send('Error fetching user info');
        }
        if (userInfo) {
            // Update existing user info
            db.run(`UPDATE user_info SET first_name = ?, last_name = ?, phone = ?, address = ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ?`, 
                [first_name, last_name, phone, address, userId], function(err) {
                    if (err) {
                        return res.status(500).send('Error updating profile');
                    }
                    res.redirect('/dashboard');
                });
            return;
        }else {
            // Insert new user info
            db.run(`INSERT INTO user_info (user_id, first_name, last_name, phone, address) VALUES (?, ?, ?, ?, ?)`, 
                [userId, first_name, last_name, phone, address], function(err) {
                    if (err) {
                        return res.status(500).send('Error updating profile');
                    }
                    res.redirect('/dashboard');
                });
        }
    });
});
app.post('/profile/changePassword', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const { old_password, new_password, confirm_password } = req.body;
    const userId = req.session.user.id;
    db.get(`SELECT * FROM users WHERE id = ? AND password = ?`, [userId, old_password], (err, user) => {
        if (err) {
            return res.status(500).send('Error fetching user');
        }
        // ดึง userInfo เพื่อส่งกลับไปหน้า profile
        db.get(`SELECT * FROM user_info WHERE user_id = ?`, [userId], (err2, userInfo) => {
            if (err2) {
                return res.status(500).send('Error fetching user info');
            }
            if (!user) {
                return res.render('profile', {
                    title: 'Profile',
                    user: req.session.user,
                    userInfo: userInfo || {},
                    message: 'Invalid old password'
                });
            }
            if (new_password !== confirm_password) {
                return res.render('profile', {
                    title: 'Profile',
                    user: req.session.user,
                    userInfo: userInfo || {},
                    message: 'New passwords do not match'
                });
            }
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [new_password, userId], (err3) => {
                if (err3) {
                    return res.status(500).send('Error updating password');
                }
                return res.render('profile', {
                    title: 'Profile',
                    user: req.session.user,
                    userInfo: userInfo || {},
                    message: 'Password changed successfully'
                });
            });
        });
    });
});

app.post('/transactions/add', (req, res) =>{
    if(!req.session.user){
        return res.redirect('/login');
    }
    const {type, amount, category, description} = req.body
    const userID = req.session.user.id
    db.run(`INSERT INTO transactions (user_id, type, amount, category, description) VALUES (?,?,?,?,?)`,
        [userID, type, amount, category, description], function (err){
            if (err){
                return res.status(500).send('Error Add Transactions');
            }
            res.redirect('/transactions');
        }
    )
});

app.get('/logout', (req, res) => {
    // Here you would typically clear the session or token
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.redirect('/login');
    });
});


//==================================== DEV =======================================
app.post('/dev/truncate/:table', (req, res) => {
    const allowedTables = ['users', 'user_info', 'transactions'];
    const table = req.params.table;
    if (!allowedTables.includes(table)) {
        return res.status(400).json({ message: 'Invalid table name.' });
    }
    db.run(`DELETE FROM ${table}`, function(err) {
        if (err) {
            return res.status(500).json({ message: `Error truncating ${table} table.` });
        }
        db.run(`DELETE FROM sqlite_sequence WHERE name = ?`, [table], function(err2) {
            if (err2) {
                return res.status(500).json({ message: `Error resetting sequence for ${table}.` });
            }
            res.json({ message: `${table} table truncated successfully.` });
        });
    });
});
//==================================== DEV =======================================

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});