const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 12);
    await pool.query(`
      INSERT INTO users (email, password_hash, full_name, role, subscription_status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
    `, ['admin@elimufiti.com', adminPassword, 'System Administrator', 'admin', 'active']);

    // Create staff user
    const staffPassword = await bcrypt.hash('staff123', 12);
    await pool.query(`
      INSERT INTO users (email, password_hash, full_name, role, school_name, subscription_status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
    `, ['staff@elimufiti.com', staffPassword, 'Grace Wanjiku', 'staff', 'Nairobi Primary School', 'active']);

    // Create student user
    const studentPassword = await bcrypt.hash('student123', 12);
    await pool.query(`
      INSERT INTO users (email, password_hash, full_name, role, school_name, subscription_status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO NOTHING
    `, ['student@elimufiti.com', studentPassword, 'John Mwangi', 'student', 'Mombasa Secondary School', 'inactive']);

    console.log('✅ Sample users created:');
    console.log('   📧 admin@elimufiti.com (password: admin123)');
    console.log('   📧 staff@elimufiti.com (password: staff123)');
    console.log('   📧 student@elimufiti.com (password: student123)');

    // Get staff user ID for sample resources
    const staffResult = await pool.query('SELECT id FROM users WHERE email = $1', ['staff@elimufiti.com']);
    const staffId = staffResult.rows[0]?.id;

    if (staffId) {
      // Create sample resources
      const sampleResources = [
        {
          title: 'Grade 5 Mathematics - Fractions and Decimals',
          description: 'Comprehensive lesson plan covering fractions and decimals with practical examples and exercises.',
          subject: 'Mathematics',
          grade: 'grade5',
          year: 2025,
          term: '1',
          resource_type: 'lesson_plan',
          is_premium: false
        },
        {
          title: 'Grade 3 English - Reading Comprehension Assessment',
          description: 'Complete assessment package with question paper, marking scheme, and answer sheet.',
          subject: 'English',
          grade: 'grade3',
          year: 2025,
          term: '1',
          resource_type: 'assessment',
          is_premium: true
        },
        {
          title: 'Grade 7 Science - The Solar System',
          description: 'Interactive lesson on planets, stars, and space exploration with visual aids.',
          subject: 'Science',
          grade: 'grade7',
          year: 2025,
          term: '1',
          resource_type: 'lesson_plan',
          is_premium: false
        }
      ];

      for (const resource of sampleResources) {
        const resourceResult = await pool.query(`
          INSERT INTO resources (title, description, subject, grade, year, term, resource_type, is_premium, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          resource.title,
          resource.description,
          resource.subject,
          resource.grade,
          resource.year,
          resource.term,
          resource.resource_type,
          resource.is_premium,
          staffId
        ]);

        // Add sample files for each resource
        await pool.query(`
          INSERT INTO resource_files (resource_id, file_name, file_url, file_size, file_type)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          resourceResult.rows[0].id,
          `${resource.title.toLowerCase().replace(/\s+/g, '_')}.pdf`,
          'https://example.com/sample-file.pdf',
          1024000,
          'main_file'
        ]);
      }

      console.log('✅ Sample resources created');
    }

    console.log('🎉 Database seeding completed successfully!');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Run seeding
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('🌟 Seeding script completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seeding script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDatabase };