require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { SYSTEM_ADMIN_DEPARTMENT } = require('../utils/adminScope');

const departmentAdmins = [
  { department: 'Computer Science', name: 'CSE Department Admin', email: 'cse.admin@school.edu' },
  { department: 'Information Technology', name: 'IT Department Admin', email: 'it.admin@school.edu' },
  { department: 'Electronics', name: 'Electronics Department Admin', email: 'electronics.admin@school.edu' },
  { department: 'Mechanical', name: 'Mechanical Department Admin', email: 'mechanical.admin@school.edu' },
  { department: 'Civil', name: 'Civil Department Admin', email: 'civil.admin@school.edu' },
  { department: 'Chemical', name: 'Chemical Department Admin', email: 'chemical.admin@school.edu' },
  { department: 'Electrical', name: 'Electrical Department Admin', email: 'electrical.admin@school.edu' },
];

const createAdminIfMissing = async ({ name, email, password, department }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    existing.status = 'active';
    existing.department = department;
    await existing.save({ validateBeforeSave: false });
    return { email, department, created: false };
  }

  await User.create({
    name,
    email,
    password,
    role: 'admin',
    status: 'active',
    department,
  });
  return { email, department, created: true };
};

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const systemPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
    const departmentPassword = process.env.DEPARTMENT_ADMIN_PASSWORD || 'Dept@123456';

    const results = [];
    results.push(await createAdminIfMissing({
      name: process.env.ADMIN_NAME || 'System Administrator',
      email: process.env.ADMIN_EMAIL || 'admin@school.edu',
      password: systemPassword,
      department: SYSTEM_ADMIN_DEPARTMENT,
    }));

    for (const admin of departmentAdmins) {
      results.push(await createAdminIfMissing({
        ...admin,
        password: departmentPassword,
      }));
    }

    console.log('');
    console.log('Admin accounts ready');
    console.log('================================');
    results.forEach((item) => {
      console.log(`${item.created ? 'Created' : 'Updated'}: ${item.email} (${item.department})`);
    });
    console.log('================================');
    console.log(`System admin password: ${systemPassword}`);
    console.log(`Department admin password: ${departmentPassword}`);
    console.log('Change these passwords after first login.');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding admins:', error.message);
    process.exit(1);
  }
};

seedAdmin();
