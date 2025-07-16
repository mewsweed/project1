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
    res.render('dashboard', {
        title: 'Dashboard',
        user: req.session.user
    });
});
app.get('/edit_profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    db.get(`SELECT * FROM user_info WHERE user_id = ?`, [req.session.user.id], (err, userInfo) => {
        if (err) {
            return res.status(500).send('Error fetching user info');
        }
        res.render('edit_profile', {
            title: 'Edit Profile',
            user: req.session.user,
            userInfo: userInfo || {}
        });
    });
});

// operations
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
    
app.post('/edit_profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    const { first_name, last_name, phone, address } = req.body;
    const userId = req.session.user.id;
    db.get(`SELECT * FROM user_info WHERE user_id = ?`, [userId], (err, userInfo) => {
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


app.get('/logout', (req, res) => {
    // Here you would typically clear the session or token
    res.redirect('/login');
});



app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});