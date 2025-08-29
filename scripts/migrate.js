const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const createTables = async () => {
  try {
    console.log('🚀 Starting database migration...');

    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'staff', 'admin')),
        school_name VARCHAR(255),
        subscription_status VARCHAR(50) DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'pending')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_login TIMESTAMP WITH TIME ZONE
      );
    `);

    // Resources table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(500) NOT NULL,
        description TEXT,
        subject VARCHAR(100) NOT NULL,
        grade VARCHAR(50) NOT NULL CHECK (grade IN ('preprimary', 'grade1', 'grade2', 'grade3', 'grade4', 'grade5', 'grade6', 'grade7', 'grade8', 'grade9', 'grade10', 'grade11', 'grade12')),
        year INTEGER NOT NULL,
        term VARCHAR(10) NOT NULL CHECK (term IN ('1', '2', '3')),
        resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN ('lesson_plan', 'worksheet', 'assessment', 'marking_scheme', 'question_paper', 'teaching_aid', 'mocks', 'schemes', 'curriculum_design', 'notes', 'holiday_assignment')),
        is_premium BOOLEAN DEFAULT FALSE,
        download_count INTEGER DEFAULT 0,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Resource files table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resource_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_size BIGINT NOT NULL,
        file_type VARCHAR(50) NOT NULL CHECK (file_type IN ('question_paper', 'marking_scheme', 'answer_sheet', 'rubric', 'main_file')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        plan VARCHAR(50) NOT NULL CHECK (plan IN ('free', 'basic', 'premium', 'institution')),
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cancelled', 'expired')),
        start_date TIMESTAMP WITH TIME ZONE NOT NULL,
        end_date TIMESTAMP WITH TIME ZONE,
        payment_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'KSH',
        plan_id VARCHAR(50) NOT NULL,
        phone_number VARCHAR(20),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
        mpesa_checkout_request_id VARCHAR(255),
        mpesa_receipt_number VARCHAR(255),
        transaction_date TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Downloads table (for tracking)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS downloads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
        downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
      
      CREATE INDEX IF NOT EXISTS idx_resources_grade ON resources(grade);
      CREATE INDEX IF NOT EXISTS idx_resources_subject ON resources(subject);
      CREATE INDEX IF NOT EXISTS idx_resources_year ON resources(year);
      CREATE INDEX IF NOT EXISTS idx_resources_term ON resources(term);
      CREATE INDEX IF NOT EXISTS idx_resources_resource_type ON resources(resource_type);
      CREATE INDEX IF NOT EXISTS idx_resources_is_premium ON resources(is_premium);
      CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_resource_files_resource_id ON resource_files(resource_id);
      
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
      
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_mpesa_checkout_request_id ON payments(mpesa_checkout_request_id);
      
      CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);
      CREATE INDEX IF NOT EXISTS idx_downloads_resource_id ON downloads(resource_id);
      CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON downloads(downloaded_at);
    `);

    console.log('✅ Database migration completed successfully!');
    console.log('📊 Created tables: users, resources, resource_files, subscriptions, payments, downloads');
    console.log('🔍 Created indexes for optimal performance');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Run migration
if (require.main === module) {
  createTables()
    .then(() => {
      console.log('🎉 Migration script completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { createTables };