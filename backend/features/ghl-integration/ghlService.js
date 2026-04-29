const axios = require('axios');
const prisma = require('../../config/prisma');

class GhlService {
    static async getAccessToken(locationId) {
        const tokenData = await prisma.ghlAuthToken.findUnique({
            where: { location_id: locationId }
        });

        if (!tokenData) throw new Error('No GHL token found for this location');

        if (new Date() >= tokenData.expires_at) {
            return await this.refreshAccessToken(tokenData);
        }

        return tokenData.access_token;
    }

    static async refreshAccessToken(tokenData) {
        try {
            const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', new URLSearchParams({
                client_id: process.env.GHL_CLIENT_ID,
                client_secret: process.env.GHL_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: tokenData.refresh_token
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const { access_token, refresh_token, expires_in } = response.data;
            const expiresAt = new Date();
            expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);

            const updated = await prisma.ghlAuthToken.update({
                where: { id: tokenData.id },
                data: { access_token, refresh_token, expires_at: expiresAt }
            });

            return updated.access_token;
        } catch (error) {
            console.error('Failed to refresh GHL token:', error.response?.data || error.message);
            throw new Error('GHL Refresh Token failed');
        }
    }

    static async getContactByEmail(locationId, email) {
        const token = await this.getAccessToken(locationId);
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId, query: email },
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Version': '2021-07-28' 
            }
        });
        return response.data.contacts[0];
    }

    static async getContactById(locationId, contactId) {
        const token = await this.getAccessToken(locationId);
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Version': '2021-07-28' 
            }
        });
        return response.data.contact;
    }

    static async updateContact(locationId, contactId, updateData) {
        const token = await this.getAccessToken(locationId);
        const response = await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, updateData, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    }

    static async createContact(locationId, contactData) {
        const token = await this.getAccessToken(locationId);
        const response = await axios.post(`https://services.leadconnectorhq.com/contacts/`, contactData, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    }
}

module.exports = GhlService;
