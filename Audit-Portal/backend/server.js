require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Configuration: Custom Field ID for the hashed password
const PASSWORD_FIELD_ID = process.env.GHL_PASSWORD_FIELD_ID || 'audit_password'; 

// Login Endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and Password are required' });
    }

    try {
        console.log(`[LOGIN] Verifying: ${email}`);

        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { 
                locationId: GHL_LOCATION_ID,
                query: email 
            },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = response.data.contacts || [];
        const user = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials or user not found' });
        }

        const customFields = user.customFields || [];
        const passwordField = customFields.find(f => f.id === PASSWORD_FIELD_ID || f.key === PASSWORD_FIELD_ID);
        const hashedPassword = passwordField ? passwordField.value : null;

        if (!hashedPassword) {
            return res.status(401).json({ success: false, message: 'Password not set for this account.' });
        }

        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // GENERATE JWT TOKEN
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.firstName },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                email: user.email
            },
            token: token
        });

    } catch (error) {
        console.error('[LOGIN ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error during login process' });
    }
});

// Signup Endpoint
app.post('/api/signup', async (req, res) => {
    const { name, email, company, password } = req.body;

    if (!email || !name || !password) {
        return res.status(400).json({ success: false, message: 'Name, Email, and Password are required' });
    }

    try {
        console.log(`[SIGNUP] Registering: ${email}`);

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const searchResponse = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        if (searchResponse.data.contacts?.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered.' });
        }

        const [firstName, ...lastNameParts] = name.split(' ');
        const lastName = lastNameParts.join(' ');

        const createResponse = await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
            locationId: GHL_LOCATION_ID,
            email: email,
            firstName: firstName,
            lastName: lastName || '.',
            companyName: company || 'New Audit Entity',
            tags: ['audit user'],
            customFields: [
                {
                    id: PASSWORD_FIELD_ID,
                    value: hashedPassword
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });

        const newUser = createResponse.data.contact;
        
        // GENERATE JWT TOKEN
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, name: newUser.firstName },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Registration successful',
            user: {
                id: newUser.id,
                name: `${newUser.firstName} ${newUser.lastName}`.trim(),
                email: newUser.email
            },
            token: token
        });

    } catch (error) {
        console.error('[SIGNUP ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error creating audit account' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Audit Portal Backend running on port ${PORT}`);
});
