const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/elimufiti_db`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const verifyTables = async () => {
  try {
    console.log('🔍 Verifying elimufiti_db migration...');
    console.log('📋 Database: elimufiti_db');
    console.log('');

    // Test connection
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');
    console.log('🕐 Current time:', testResult.rows[0].now);
    console.log('');

    // Check all tables exist
    const tablesResult = await pool.query(`
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'resources', 'resource_files', 'downloads')
      ORDER BY 
        CASE table_name 
          WHEN 'users' THEN 1
          WHEN 'resources' THEN 2  
          WHEN 'resource_files' THEN 3
          WHEN 'downloads' THEN 4
        END;
    `);

    console.log('📊 TABLES STATUS:');
    console.log('================');

    const expectedTables = ['users', 'resources', 'resource_files', 'downloads'];
    const foundTables = tablesResult.rows.map(row => row.table_name);

    expectedTables.forEach(tableName => {
      const found = foundTables.includes(tableName);
      const tableInfo = tablesResult.rows.find(row => row.table_name === tableName);
      
      if (found) {
        console.log(`✅ ${tableName.padEnd(15)} - ${tableInfo.column_count} columns`);
      } else {
        console.log(`❌ ${tableName.padEnd(15)} - MISSING`);
      }
    });

    console.log('');

    // Check resources table structure
    if (foundTables.includes('resources')) {
      const resourcesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'resources' 
        ORDER BY ordinal_position;
      `);

      console.log('📋 RESOURCES TABLE STRUCTURE:');
      console.log('=============================');
      resourcesColumns.rows.forEach(col => {
        console.log(`   ${col.column_name.padEnd(20)} | ${col.data_type.padEnd(15)} | ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      console.log('');
    }

    // Check resource_files table structure  
    if (foundTables.includes('resource_files')) {
      const filesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'resource_files' 
        ORDER BY ordinal_position;
      `);

      console.log('📁 RESOURCE_FILES TABLE STRUCTURE:');
      console.log('==================================');
      filesColumns.rows.forEach(col => {
        console.log(`   ${col.column_name.padEnd(20)} | ${col.data_type.padEnd(15)} | ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      console.log('');
    }

    // Check indexes
    const indexesResult = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename IN ('resources', 'resource_files', 'downloads')
      ORDER BY tablename, indexname;
    `);

    console.log('🔍 PERFORMANCE INDEXES:');
    console.log('======================');
    if (indexesResult.rows.length > 0) {
      indexesResult.rows.forEach(idx => {
        console.log(`✅ ${idx.tablename}.${idx.indexname}`);
      });
    } else {
      console.log('❌ No indexes found');
    }
    console.log('');

    // Check foreign key constraints
    const constraintsResult = await pool.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_name IN ('resources', 'resource_files', 'downloads')
      ORDER BY tc.table_name;
    `);

    console.log('🔗 FOREIGN KEY RELATIONSHIPS:');
    console.log('=============================');
    if (constraintsResult.rows.length > 0) {
      constraintsResult.rows.forEach(fk => {
        console.log(`✅ ${fk.table_name}.${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
      });
    } else {
      console.log('❌ No foreign keys found');
    }
    console.log('');

    // Count existing data
    if (foundTables.includes('users')) {
      const userCount = await pool.query('SELECT COUNT(*) FROM users');
      console.log('📊 DATA COUNTS:');
      console.log('===============');
      console.log(`👥 Users: ${userCount.rows[0].count}`);
    }

    if (foundTables.includes('resources')) {
      const resourceCount = await pool.query('SELECT COUNT(*) FROM resources');
      console.log(`📚 Resources: ${resourceCount.rows[0].count}`);
    }

    if (foundTables.includes('resource_files')) {
      const filesCount = await pool.query('SELECT COUNT(*) FROM resource_files');
      console.log(`📁 Resource Files: ${filesCount.rows[0].count}`);
    }

    if (foundTables.includes('downloads')) {
      const downloadsCount = await pool.query('SELECT COUNT(*) FROM downloads');
      console.log(`⬇️  Downloads: ${downloadsCount.rows[0].count}`);
    }

    console.log('');

    // Final status
    const allTablesExist = expectedTables.every(table => foundTables.includes(table));
    
    if (allTablesExist) {
      console.log('🎉 MIGRATION VERIFICATION: SUCCESS!');
      console.log('✅ All required tables exist');
      console.log('✅ Database structure is ready');
      console.log('✅ Ready for resource uploads');
      console.log('');
      console.log('🚀 Next steps:');
      console.log('   1. Configure R2 credentials in .env');
      console.log('   2. Start your API server: npm run dev');
      console.log('   3. Test file upload: POST /api/uploads/files');
      console.log('   4. Create resources: POST /api/resources');
    } else {
      console.log('❌ MIGRATION VERIFICATION: INCOMPLETE');
      console.log('⚠️  Some tables are missing');
      console.log('🔧 Please run: npm run migrate');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Run verification
if (require.main === module) {
  verifyTables()
    .then(() => {
      console.log('🌟 Verification completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyTables };