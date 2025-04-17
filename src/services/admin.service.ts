import { AppDataSource } from '../config/data-source';
import { Course } from '../entity/course.entity';
import { User } from '../entity/user.entity';
import { UserRole } from '../enums/UserRole';
import bcrypt from 'bcrypt';
import { sendAccountEmail } from '../utils/sendMail';
import { CreateUserDTO } from '../dtos/create-user.dto';

const courseRepository = AppDataSource.getRepository(Course);
const userRepository = AppDataSource.getRepository(User);

export const getStatistics = async () => {
  // Thống kê số lượng khóa học
  const totalCourses = await courseRepository.count();

  // Thống kê số lượng giảng viên
  const totalInstructors = await userRepository.count({
    where: {
      role: UserRole.INSTRUCTOR, // Sử dụng enum UserRole
    },
  });

  // Thống kê số lượng giảng viên đang chờ phê duyệt
  const pendingInstructors = await userRepository.count({
    where: {
      role: UserRole.PENDING_APPROVAL,
    },
  });

  return {
    totalCourses,
    totalInstructors,
    pendingInstructors,
  };
};

// Lấy danh sách giảng viên đang chờ phê duyệt
export const getPendingInstructors = async () => {
  const pendingInstructors = await userRepository.find({
    where: {
      role: UserRole.PENDING_APPROVAL,
    },
  });

  return pendingInstructors;
};

export const approveInstructor = async (userId: string): Promise<User> => {
  const user = await userRepository.findOneBy({ id: userId });
  if (!user) {
    throw new Error('User not found');
  }

  user.role = UserRole.INSTRUCTOR;
  await userRepository.save(user);

  return user;
};

export const rejectInstructor = async (userId: string): Promise<void> => {
  const user = await userRepository.findOneBy({ id: userId });
  if (!user) {
    throw new Error('User not found');
  }
  await userRepository.remove(user);
};

export const getInstructorDetails = async (userId: string): Promise<User> => {
  const user = await userRepository.findOneBy({ id: userId });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

export const searchInstructors = async (keyword: string): Promise<User[]> => {
  const query = userRepository
    .createQueryBuilder('user')
    .where('user.name LIKE :keyword', { keyword: `%${keyword}%` })
    .andWhere('user.role = :role', { role: UserRole.INSTRUCTOR });

  const instructors = await query.getMany();
  return instructors;
};

export const searchStudents = async (keyword: string): Promise<User[]> => {
  const query = userRepository
    .createQueryBuilder('user')
    .where('user.name LIKE :keyword', { keyword: `%${keyword}%` })
    .andWhere('user.role = :role', { role: UserRole.STUDENT });

  const students = await query.getMany();
  return students;
};

export const createUserAccount = async (dto: CreateUserDTO): Promise<User> => {

  const existingUser = await userRepository.findOne({ where: { email: dto.email } });
  if (existingUser) {
    throw new Error('errors.email_taken');
  }

  const password = Math.random().toString(36).slice(-8);
  const hash = await bcrypt.hash(password, 10);

  const user = userRepository.create({
    name: dto.name,
    email: dto.email,
    hash_password: hash,
    role: dto.role,
  });

  const savedUser = await userRepository.save(user);
  await sendAccountEmail(dto.email, dto.email, password, dto.role);
  console.log('User created:', savedUser);
  return savedUser;
};