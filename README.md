# Elimufiti Backend API

Complete backend API for the Elimufiti CBC Resources Platform built with Node.js, Express, and PostgreSQL.

## 🚀 Features

- **Authentication & Authorization** - JWT-based auth with role-based access control
- **Resource Management** - CRUD operations for educational resources
- **File Uploads** - Cloudinary integration for file storage
- **M-Pesa Integration** - Complete payment processing with STK Push
- **Subscription Management** - Handle user subscriptions and plans
- **Download Tracking** - Track resource downloads and user activity
- **Admin Dashboard** - User and content management APIs

## 📋 Prerequisites

- Node.js 16+ 
- PostgreSQL 12+
- Cloudinary account (for file uploads)
- M-Pesa Developer Account (for payments)

## 🛠️ Installation

1. **Clone and setup:**
   ```bash
   cd backend
   npm install
   ```

2. **Environment setup:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Database setup:**
   ```bash
   # Create database
   createdb elimufiti_db
   
   # Run migrations
   npm run migrate
   
   # Seed sample data
   npm run seed
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

## 🔧 Environment Variables

### Required Configuration:
```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/elimufiti_db

# JWT
JWT_SECRET=your_super_secret_jwt_key_here

# Cloudinary (File uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# M-Pesa (Payments)
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/payments/mpesa/callback
```

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### Users
- `GET /api/users/profile` - Get current user profile
- `PUT /api/users/profile` - Update user profile
- `GET /api/users/downloads` - Get download history
- `GET /api/users` - Get all users (admin only)

### Resources
- `GET /api/resources` - Get resources with filtering
- `GET /api/resources/:id` - Get single resource
- `POST /api/resources` - Create resource (staff/admin)
- `POST /api/resources/:id/download` - Track download

### Subscriptions
- `GET /api/subscriptions/plans` - Get subscription plans
- `GET /api/subscriptions/current` - Get current subscription
- `POST /api/subscriptions` - Create subscription
- `POST /api/subscriptions/cancel` - Cancel subscription

### Payments
- `POST /api/payments/mpesa/initiate` - Initiate M-Pesa payment
- `POST /api/payments/mpesa/callback` - M-Pesa callback (webhook)
- `GET /api/payments/:id/status` - Check payment status
- `GET /api/payments/history` - Get payment history

### File Uploads
- `POST /api/uploads/files` - Upload files to Cloudinary
- `DELETE /api/uploads/files/:publicId` - Delete file

## 🗄️ Database Schema

### Users Table
- Authentication and user management
- Role-based access control (student, staff, admin)
- Subscription status tracking

### Resources Table
- Educational resource metadata
- CBC curriculum alignment
- Premium/free classification

### Resource Files Table
- File attachments for resources
- Multiple file types support
- Cloudinary integration

### Subscriptions Table
- User subscription management
- Plan tracking and billing cycles

### Payments Table
- M-Pesa payment processing
- Transaction history and status

### Downloads Table
- Resource download tracking
- User activity analytics

## 🔐 Authentication

The API uses JWT tokens for authentication:

```javascript
// Include in request headers
Authorization: Bearer <your_jwt_token>
```

### User Roles:
- **Student**: Basic resource access
- **Staff**: Upload and manage resources
- **Admin**: Full system access

## 💳 M-Pesa Integration

Complete M-Pesa STK Push implementation:

1. **Initiate Payment**: `POST /api/payments/mpesa/initiate`
2. **User enters PIN** on their phone
3. **Callback received**: `POST /api/payments/mpesa/callback`
4. **Subscription activated** automatically

## 📁 File Upload Flow

1. **Upload files**: `POST /api/uploads/files`
2. **Files stored** in Cloudinary
3. **URLs returned** for resource creation
4. **Resources created** with file references

## 🚀 Deployment

### Production Setup:
1. **Set environment variables**
2. **Run migrations**: `npm run migrate`
3. **Start server**: `npm start`

### Recommended Stack:
- **Server**: Vultr VPS or DigitalOcean
- **Database**: PostgreSQL (managed service)
- **File Storage**: Cloudinary
- **Domain**: Custom domain with SSL

## 📊 Sample Data

After running `npm run seed`, you'll have:

### Test Users:
- **Admin**: admin@elimufiti.com (password: admin123)
- **Staff**: staff@elimufiti.com (password: staff123)  
- **Student**: student@elimufiti.com (password: student123)

### Sample Resources:
- Grade 5 Mathematics lesson
- Grade 3 English assessment
- Grade 7 Science lesson

## 🔍 API Testing

Use the health check endpoint:
```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "OK",
  "message": "Elimufiti API is running",
  "timestamp": "2025-01-16T10:30:00.000Z",
  "environment": "development"
}
```

## 🛡️ Security Features

- **Helmet.js** - Security headers
- **Rate limiting** - Prevent abuse
- **Input validation** - Express validator
- **Password hashing** - bcryptjs
- **CORS protection** - Configurable origins
- **JWT expiration** - Token lifecycle management

## 📈 Performance

- **Database indexing** - Optimized queries
- **Compression** - Gzip response compression
- **Connection pooling** - PostgreSQL connection management
- **File size limits** - 10MB upload limit

## 🐛 Error Handling

Comprehensive error handling with:
- Validation errors
- Database errors  
- Authentication errors
- File upload errors
- Payment processing errors

## 📝 Logging

- **Morgan** - HTTP request logging
- **Console logging** - Development debugging
- **Error tracking** - Production error monitoring

---

**Ready to power your Elimufiti platform! 🚀**