const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false // Local development
});

const verifyElimufiti = async () => {
  try {
    console.log('🔍 Verifying elimufiti_db migration...');
    console.log('📋 Database: elimufiti_db');
    console.log('🔗 Connection: postgresql://postgres:***@localhost:5432/elimufiti_db');
    console.log('');

    // Test connection
    const testResult = await pool.query('SELECT NOW(), current_database()');
    console.log('✅ Database connection successful');
    console.log('📊 Connected to:', testResult.rows[0].current_database);
    console.log('🕐 Current time:', testResult.rows[0].now);
    console.log('');

    // Check all tables exist
    const tablesResult = await pool.query(`
      SELECT 
        table_name, 
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log('📊 ALL TABLES IN elimufiti_db:');
    console.log('==============================');
    tablesResult.rows.forEach(table => {
      console.log(`   ${table.table_name.padEnd(20)} - ${table.column_count} columns`);
    });
    console.log('');

    // Check specifically for our required tables
    const requiredTables = ['users', 'resources', 'resource_files', 'downloads'];
    const existingTables = tablesResult.rows.map(row => row.table_name);

    console.log('🎯 REQUIRED TABLES STATUS:');
    console.log('==========================');
    requiredTables.forEach(tableName => {
      const exists = existingTables.includes(tableName);
      if (exists) {
        const tableInfo = tablesResult.rows.find(row => row.table_name === tableName);
        console.log(`✅ ${tableName.padEnd(15)} - ${tableInfo.column_count} columns`);
      } else {
        console.log(`❌ ${tableName.padEnd(15)} - MISSING`);
      }
    });
    console.log('');

    // If resources table exists, show its structure
    if (existingTables.includes('resources')) {
      const resourcesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'resources' 
        ORDER BY ordinal_position;
      `);

      console.log('📋 RESOURCES TABLE STRUCTURE:');
      console.log('=============================');
      resourcesColumns.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const defaultVal = col.column_default ? ` (${col.column_default})` : '';
        console.log(`   ${col.column_name.padEnd(20)} | ${col.data_type.padEnd(15)} | ${nullable}${defaultVal}`);
      });
      console.log('');
    }

    // If resource_files table exists, show its structure  
    if (existingTables.includes('resource_files')) {
      const filesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'resource_files' 
        ORDER BY ordinal_position;
      `);

      console.log('📁 RESOURCE_FILES TABLE STRUCTURE:');
      console.log('==================================');
      filesColumns.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`   ${col.column_name.padEnd(20)} | ${col.data_type.padEnd(15)} | ${nullable}`);
      });
      console.log('');
    }

    // Check foreign key constraints
    const constraintsResult = await pool.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
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
      console.log('❌ No foreign keys found (tables may not exist yet)');
    }
    console.log('');

    // Count data in each table
    console.log('📊 DATA COUNTS:');
    console.log('===============');
    
    for (const tableName of requiredTables) {
      if (existingTables.includes(tableName)) {
        try {
          const countResult = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
          console.log(`📋 ${tableName.padEnd(15)}: ${countResult.rows[0].count} rows`);
        } catch (error) {
          console.log(`❌ ${tableName.padEnd(15)}: Error counting rows`);
        }
      }
    }
    console.log('');

    // Final status
    const allTablesExist = requiredTables.every(table => existingTables.includes(table));
    
    if (allTablesExist) {
      console.log('🎉 MIGRATION VERIFICATION: SUCCESS!');
      console.log('✅ All required tables exist in elimufiti_db');
      console.log('✅ Database structure is ready');
      console.log('✅ Ready for resource uploads');
      console.log('');
      console.log('🚀 Next steps:');
      console.log('   1. Update R2 credentials in .env');
      console.log('   2. Start API server: npm run dev');
      console.log('   3. Test upload: POST /api/uploads/files');
      console.log('   4. Create resources: POST /api/resources');
    } else {
      console.log('❌ MIGRATION VERIFICATION: INCOMPLETE');
      console.log('⚠️  Missing tables:', requiredTables.filter(table => !existingTables.includes(table)));
      console.log('🔧 Please run: npm run migrate');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
    console.error('🔧 Check your database connection and credentials');
  } finally {
    await pool.end();
  }
};

// Run verification
if (require.main === module) {
  verifyElimufiti()
    .then(() => {
      console.log('🌟 Verification completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyElimufiti };