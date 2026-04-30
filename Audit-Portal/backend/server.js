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
            return res.status(401).json({ 
                success: false, 
                message: 'Account not found. Please register to gain access.',
                needsRegistration: true 
            });
        }

        const customFields = user.customFields || [];
        const passwordField = customFields.find(f => f.id === PASSWORD_FIELD_ID || f.key === PASSWORD_FIELD_ID);
        const hashedPassword = passwordField ? passwordField.value : null;

        if (!hashedPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Account found but no password set. Please use the Registration form to set your password.',
                needsRegistration: true 
            });
        }

        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. If you forgot your password, please contact the administrator.' });
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

        // Check if user already exists
        const searchResponse = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = searchResponse.data.contacts || [];
        const existingUser = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (existingUser) {
            const customFields = existingUser.customFields || [];
            const passwordField = customFields.find(f => f.id === PASSWORD_FIELD_ID || f.key === PASSWORD_FIELD_ID);
            
            if (passwordField && passwordField.value) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Email already registered with a password. Please login or contact the administrator for a reset.' 
                });
            }

            // Case: User exists but has no password -> UPDATE existing contact
            console.log(`[SIGNUP] Updating existing contact: ${existingUser.id}`);
            
            // Add the audit tag to the existing user
            const existingTags = existingUser.tags || [];
            const newTags = [...new Set([...existingTags, 'audit user'])];

            const updateResponse = await axios.put(`https://services.leadconnectorhq.com/contacts/${existingUser.id}`, {
                tags: newTags,
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

            const updatedUser = updateResponse.data.contact;
            const token = jwt.sign(
                { id: updatedUser.id, email: updatedUser.email, name: updatedUser.firstName },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.json({
                success: true,
                message: 'Password set successfully for existing account.',
                user: {
                    id: updatedUser.id,
                    name: `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
                    email: updatedUser.email
                },
                token: token
            });
        }

        // Case: User does not exist -> CREATE new contact
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

// Forgot Password / Contact Admin Endpoint
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    try {
        // We still check GHL to verify they are a contact
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = response.data.contacts || [];
        const userExists = contacts.some(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (!userExists) {
            return res.json({ 
                success: false, 
                message: 'No account found with this email. Please register for access.' 
            });
        }

        // Return the admin contact instruction
        return res.json({
            success: true,
            message: 'Account verified. Please contact your AUSTRAC Review Administrator at compliance@centinl.com to reset your password.'
        });

    } catch (error) {
        console.error('[FORGOT PASSWORD ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error verifying account.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Audit Portal Backend running on port ${PORT}`);
});
