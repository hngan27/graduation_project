import pug from 'pug';
import path from 'path';
import sendEmail, { mailOptionsTemplate } from '../config/nodemailer-config';
import { AppDataSource } from '../config/data-source';
import { Course } from '../entity/course.entity';
import { User } from '../entity/user.entity';
import { Enrollment } from '../entity/enrollment.entity';
import { Lesson } from '../entity/lesson.entity';
import { StudentLesson } from '../entity/student_lesson.entity';
import { Grade } from '../entity/grade.entity';
import { UserRole } from '../enums/UserRole';
import { EnrollStatus } from '../enums/EnrollStatus';
import { AssignmentStatus } from '../enums/AssignmentStatus';
import { Assignment } from '../entity/assignment.entity';
import { CourseLevel } from '../enums';
import { getBestGradeByCourseId, getQuestionsByExamId } from './exam.service';
import { getUserById } from './user.service';
import { getLessonById } from './lesson.service';
import { CourseWithStudentCount } from '../helpers/course.helper';

const courseRepository = AppDataSource.getRepository(Course);
const enrollmentRepository = AppDataSource.getRepository(Enrollment);
const lessonRepository = AppDataSource.getRepository(Lesson);
const studentLessonRepository = AppDataSource.getRepository(StudentLesson);
const assignmentRepository = AppDataSource.getRepository(Assignment);
const gradeRepository = AppDataSource.getRepository(Grade);
const userRepository = AppDataSource.getRepository(User);

export const getCoursesWithStudentCount = async (courses: Course[]) => {
  const studentCountsPromises = courses.map(course => {
    return getStudentCountByCourseId(course.id);
  });

  const studentCounts = await Promise.all(studentCountsPromises);

  const allCoursesWithStudentCount: CourseWithStudentCount[] = courses.map(
    (course, index) => {
      return {
        ...course,
        studentCount: studentCounts[index],
      };
    }
  );

  allCoursesWithStudentCount.sort((a, b) => b.studentCount! - a.studentCount!);

  return allCoursesWithStudentCount;
};

export const getCourseList = async () => {
  const allCourses = await courseRepository.find({
    relations: ['instructor', 'subInstructor'],
    order: { name: 'ASC' },
  });

  return getCoursesWithStudentCount(allCourses);
};

export const getUserCourseList = async (user: User) => {
  if (user.role === UserRole.INSTRUCTOR) {
    const courses = await courseRepository.find({
      where: [
        { instructor: { id: user.id } },
        { subInstructor: { id: user.id } },
      ],
    });

    return getCoursesWithStudentCount(courses);
  } else {
    const enrollments = await enrollmentRepository.find({
      where: { student: { id: user.id } },
      relations: {
        course: {
          lessons: true,
          assignment: true,
          enrollments: true,
        },
      },
      order: { status: 'ASC', enrollment_date: 'DESC' },
    });
    return enrollments.map(enrollment => {
      return {
        ...enrollment.course,
        enrollStatus: enrollment.status,
        studentCount: enrollment.course.enrollments.length,
      };
    });
  }
};

export const getCourseById = async (id: string) => {
  return courseRepository.findOne({
    where: { id },
    relations: ['instructor', 'subInstructor'],
  });
};

export const getCoursesByInstructorId = async (
  instructorId: string
): Promise<Course[]> => {
  return await courseRepository
    .createQueryBuilder('course')
    .where('course.instructor_id = :instructorId', { instructorId })
    .getMany();
};

export const getCourseDetails = async (
  courseId: string
): Promise<Course | null> => {
  return await courseRepository.findOne({
    where: { id: courseId },
    relations: [
      'instructor',
      'subInstructor',
      'enrollments',
      'lessons',
      'assignment',
    ],
  });
};

export const getStudentCountByCourseId = async (
  courseId: string
): Promise<number> => {
  return await enrollmentRepository.count({
    where: { course: { id: courseId } },
  });
};

export const getEnrollment = async (
  course: Course,
  student: User | undefined
): Promise<Enrollment | null> => {
  if (!student) {
    return null;
  }

  return enrollmentRepository.findOne({
    where: { course: { id: course.id }, student: { id: student.id } },
  });
};

export const enrollCourse = async (
  course: Course,
  user: User
): Promise<void> => {
  const enrollment = new Enrollment({
    course,
    student: user,
    enrollment_date: new Date(),
    status: EnrollStatus.PENDING,
  });

  await enrollmentRepository.save(enrollment);

  const htmlContent = pug.renderFile(
    path.join(__dirname, '../views/emails/enroll.pug'),
    {
      course,
      student: user,
      enrollment_date: enrollment.enrollment_date,
    }
  );

  const mailOptions = {
    ...mailOptionsTemplate,
    to: [course.instructor.email, course.subInstructor?.email],
    subject: '[Smart Education] New Request Enrollment Course',
    html: htmlContent,
  };

  sendEmail(mailOptions);
};

export const approveEnrollment = async (
  enrollmentId: string
): Promise<void> => {
  const enrollment = await enrollmentRepository.findOne({
    relations: ['course', 'course.instructor', 'student'],
    where: { id: enrollmentId },
  });

  if (enrollment) {
    enrollment.status = EnrollStatus.APPROVED;
    await enrollmentRepository.save(enrollment);

    const lessons = await lessonRepository.find({
      relations: ['courses', 'studentLessons'],
      where: { courses: { id: enrollment.course.id } },
    });

    for (const lesson of lessons) {
      const studentLesson = await studentLessonRepository.findOne({
        where: {
          student: { id: enrollment.student.id },
          lesson: { id: lesson.id },
        },
      });
      if (!studentLesson) {
        const newStudentLesson = new StudentLesson({
          student: enrollment.student,
          lesson,
        });
        await studentLessonRepository.save(newStudentLesson);
      }
    }

    const assignment = await assignmentRepository.findOne({
      where: { course: { id: enrollment.course.id } },
    });

    if (assignment) {
      const grade = await gradeRepository.findOne({
        where: {
          student: { id: enrollment.student.id },
          assignment: { id: assignment.id },
        },
      });
      if (!grade) {
        const questions = await getQuestionsByExamId(assignment.id);
        const newGrade = new Grade({
          student: enrollment.student,
          assignment,
          grade: 0,
          max_grade: questions.length,
        });
        await gradeRepository.save(newGrade);
      }
    }

    const htmlContent = pug.renderFile(
      path.join(__dirname, '../views/emails/approved.pug'),
      {
        course: enrollment.course,
      }
    );

    const mailOptions = {
      ...mailOptionsTemplate,
      to: [enrollment.student.email],
      subject: '[Smart Education] Course Enrollment Approved',
      html: htmlContent,
    };

    sendEmail(mailOptions);
  }
};

export const rejectEnrollment = async (enrollmentId: string): Promise<void> => {
  const enrollment = await enrollmentRepository.findOne({
    relations: ['course', 'course.instructor', 'student'],
    where: { id: enrollmentId },
  });

  if (enrollment) {
    enrollment.status = EnrollStatus.REJECTED;
    await enrollmentRepository.save(enrollment);

    const htmlContent = pug.renderFile(
      path.join(__dirname, '../views/emails/rejected.pug'),
      {
        course: enrollment.course,
      }
    );

    const mailOptions = {
      ...mailOptionsTemplate,
      to: [enrollment.student.email],
      subject: '[Smart Education] Course Enrollment Rejected',
      html: htmlContent,
    };

    sendEmail(mailOptions);
  }
};

export const deleteEnrollment = async (enrollmentId: string) => {
  return enrollmentRepository.delete(enrollmentId);
};

export const getProgressInCourse = async (
  course: Course,
  student: User
): Promise<number> => {
  const courseDetail = await getCourseDetails(course.id);
  const lessons = courseDetail?.lessons || [];

  const totalLesson = lessons.length;
  let totalDone = 0;
  for (const lesson of lessons) {
    const studentLesson = await studentLessonRepository.findOne({
      where: { student: { id: student.id }, lesson: { id: lesson.id } },
    });
    if (studentLesson && studentLesson.done === true) {
      totalDone++;
    }
  }

  const assignment = await assignmentRepository.findOne({
    where: { course: { id: course.id } },
  });

  if (!assignment) {
    return Math.floor((totalDone / totalLesson) * 100);
  }

  const bestGradeOfStudent = await getBestGradeByCourseId(
    course.id,
    student.id
  );

  if (
    bestGradeOfStudent &&
    bestGradeOfStudent.status === AssignmentStatus.PASS
  ) {
    totalDone++;
  }

  return Math.floor((totalDone / (totalLesson + 1)) * 100);
};

export const getEnrollmentForInstructor = async (
  instructor: User
): Promise<Enrollment[]> => {
  const courses = await getUserCourseList(instructor);
  const enrollments: Enrollment[] = [];
  for (const course of courses) {
    const enrollmentsOfCourse = await enrollmentRepository.find({
      where: { course: { id: course.id } },
      relations: ['student', 'course'],
    });
    enrollments.push(...enrollmentsOfCourse);
  }

  return enrollments.sort((a, b) =>
    a.enrollment_date < b.enrollment_date ? 1 : -1
  );
};

export const getEnrollmentForCourse = async (
  course: Course
): Promise<Enrollment[]> => {
  return enrollmentRepository.find({
    where: { course: { id: course.id } },
    relations: ['student', 'course'],
  });
};

export const createCourse = async (
  att: Record<string, string>,
  instructor: User
): Promise<Course> => {
  const course = new Course();
  course.name = att.name;
  course.description = att.description;
  course.level = att.level as CourseLevel;
  course.duration = att.duration;
  course.instructor = instructor;
  course.image_url = att.image_url;

  const subInstructorId = att.subInstructor;
  const subInstructor = await getUserById(subInstructorId);
  if (subInstructor) course.subInstructor = subInstructor;

  const lessonIdsArray = att.lessonIds.split(', ');
  const lessonPromises = lessonIdsArray.map((id: string) => getLessonById(id));

  const lessons = await Promise.all(lessonPromises);

  course.lessons = lessons.filter(lesson => lesson !== null);

  return courseRepository.save(course);
};

export const updateCourse = async (
  course: Course,
  att: Record<string, string>
): Promise<Course> => {
  course.name = att.name;
  course.description = att.description;
  course.level = att.level as CourseLevel;
  course.duration = att.duration;
  course.image_url = att.image_url || course.image_url;

  const subInstructorId = att.subInstructor;
  const subInstructor = await getUserById(subInstructorId);
  if (subInstructor) course.subInstructor = subInstructor;

  const lessonIdsArray = att.lessonIds.split(', ');
  const lessonPromises = lessonIdsArray.map((id: string) => getLessonById(id));

  const lessons = await Promise.all(lessonPromises);

  course.lessons = lessons.filter(lesson => lesson !== null);

  return courseRepository.save(course);
};

export const deleteCourse = async (id: string) => {
  return courseRepository.delete(id);
};

export const findCoursesByInstructorId = async (instructorId: string) => {
  const instructor = await userRepository.findOneBy({ id: instructorId });

  if (!instructor) {
    throw new Error('Instructor not found');
  }

  return await courseRepository.find({
    where: { instructor },
    relations: ['enrollments'],
  });
};

export const deleteCoursesByInstructorId = async (
  instructorId: string
): Promise<void> => {
  await courseRepository.delete({ instructor: { id: instructorId } });
};
