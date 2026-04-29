const bcrypt = require('bcrypt');
const prisma = require('../../config/prisma');
const GhlService = require('./ghlService');

const handleWebhook = async (req, res) => {
  try {
    const { email, locationId, contactId } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    let ghlData = null;
    try {
        if (locationId && contactId) {
            ghlData = await GhlService.getContactById(locationId, contactId);
        }
    } catch (err) {
        console.error('Automation Error: Could not fetch GHL contact details', err.message);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    const userData = {
        name: ghlData ? `${ghlData.firstName} ${ghlData.lastName}` : (req.body.name || 'GHL Lead'),
        phone: ghlData ? ghlData.phone : req.body.phone,
        custom_fields: ghlData ? ghlData.customFields : (req.body.custom_fields || {})
    };

    if (existingUser) {
        await prisma.user.update({
            where: { id: existingUser.id },
            data: userData
        });
        return res.status(200).json({ message: 'User updated with GHL data' });
    } else {
        const tempPassword = Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(tempPassword, salt);

        const newUser = await prisma.user.create({
            data: {
                email,
                password_hash,
                ...userData,
                role: 'user'
            }
        });

        return res.status(201).json({ message: 'User created from GHL Automation', userId: newUser.id });
    }

  } catch (error) {
    console.error('Webhook processing failed:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = { handleWebhook };
