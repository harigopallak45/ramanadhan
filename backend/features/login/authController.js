const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../../config/prisma');

const signup = async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password_hash,
        phone,
        role: role || 'user',
        custom_fields: {}
      }
    });

    await prisma.log.create({
      data: {
        level: 'info',
        message: 'New user signed up',
        meta: { userId: newUser.id, email }
      }
    });

    res.status(201).json({ message: 'User created successfully', userId: newUser.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' },
      async (err, token) => {
        if (err) throw err;

        const expiresInStr = process.env.JWT_EXPIRES_IN || '1d';
        let expiresAt = new Date();
        if (expiresInStr.endsWith('d')) {
          expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInStr));
        } else {
          expiresAt.setDate(expiresAt.getDate() + 1);
        }

        await prisma.session.create({
          data: {
            user_id: user.id,
            token: token,
            ip_address: req.ip || req.headers['x-forwarded-for'],
            user_agent: req.headers['user-agent'],
            expires_at: expiresAt
          }
        });

        res.json({
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        });
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

const logout = async (req, res) => {
  try {
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await prisma.session.updateMany({
        where: { token: token },
        data: { is_valid: false }
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during logout' });
  }
};

module.exports = { signup, login, logout };
