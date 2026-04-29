const jwt = require('jsonwebtoken');
const prisma = require('../../config/prisma');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const session = await prisma.session.findUnique({
      where: { token: token }
    });

    if (!session || !session.is_valid || session.expires_at < new Date()) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }

    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};

module.exports = authMiddleware;
