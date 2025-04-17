import { getAllUserGradesByCourseId } from './../services/exam.service';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import i18next from 'i18next';
import * as courseService from '../services/course.service';
import * as lessonService from '../services/lesson.service';
import * as userService from '../services/user.service';
import { Course } from '../entity/course.entity';
import { CourseLevel } from '../enums/CourseLevel';
import { CourseWithEnrollStatus } from '../helpers/course.helper';
import { UserRole } from '../enums/UserRole';
import { LIMIT_RECORDS } from '../constants';
import cloudinary from '../config/cloudinary-config';
import { CourseStatus } from '../enums/CourseStatus';
import { EnrollmentWithProgress } from '../helpers/enrollment.helper';
import { EnrollStatus } from '../enums/EnrollStatus';

export const courseList = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const allCourses = await courseService.getCourseList();

    let myCourses: CourseWithEnrollStatus[] = [];
    if (req.session.user) {
      myCourses = await courseService.getUserCourseList(req.session.user);
    }
    const courseRecommends = allCourses.filter(
      course => !myCourses.find(myCourse => myCourse.id === course.id)
    );

    const levelFilter = req.query.level;
    const statusFilter = req.query.status;
    const filteredMyCourses = myCourses.filter(course => {
      if (levelFilter && course.level !== levelFilter) return false;
      if (statusFilter && course.enrollStatus !== statusFilter) return false;
      return true;
    });

    res.render('courses/index', {
      title: req.t('title.list_course'),
      courseRecommends,
      myCourses: filteredMyCourses,
      levelFilter,
      statusFilter,
      currentPath: req.baseUrl,
    });
  }
);

async function validateCourse(
  req: Request,
  res: Response
): Promise<Course | null> {
  const courseId = req.params.id;
  if (!courseId) {
    const errorMessageId = i18next.t('error.invalidId');
    res.status(404).send(errorMessageId);
    return null;
  }

  const course = await courseService.getCourseDetails(courseId);
  if (course === null) {
    req.flash('error', i18next.t('error.courseNotFound'));
    res.redirect('/error');
    return null;
  }

  return course;
}

async function uploadImage(req: Request) {
  let image_url = '';
  if (req.file) {
    const result = await cloudinary.v2.uploader.upload(req.file.path, {
      folder: 'course_images',
    });
    image_url = result.secure_url;
    fs.unlinkSync(req.file.path);
  }
  return image_url;
}

async function getAttributesForView(req: Request, res: Response) {
  const instructor = req.session.user!;
  const subInstructors = await userService.getSubInstructorList(instructor);
  const lessons = await lessonService.getLessonListOfInstructor(instructor);
  if (!req.params.id)
    return {
      subInstructors,
      lessons,
    };
  const course = await validateCourse(req, res);
  const lessonIdsSelected = course?.lessons.map(lesson => lesson.id);
  const lessonNamesSelected = course?.lessons.map(lesson => lesson.title);
  return {
    subInstructors,
    lessons,
    course,
    lessonIdsSelected,
    lessonNamesSelected,
  };
}

// Hiển thị trang chi tiết của một khóa học cụ thể.
export const courseDetail = async (req: Request, res: Response) => {
  const course = await validateCourse(req, res);
  if (course === null) return;

  // Đếm số lượng sinh viên đã đăng ký khóa học
  const studentCount = await courseService.getStudentCountByCourseId(course.id);

  // Lấy danh sách bài học của khóa học
  const lessons = await lessonService.getLessonsByCourseId(course.id);

  // Kiểm tra xem người dùng đã đăng ký khóa học chưa
  const enrollment = await courseService.getEnrollment(
    course,
    req.session.user
  );

  try {
    res.render('courses/detail', {
      title: req.t('title.course_detail'),
      course,
      CourseLevel,
      lessons,
      studentCount,
      enrollment,
    });
  } catch (error) {
    req.flash('error', i18next.t('error.failedToRetrieveCourseDetails'));
    res.redirect('/error');
  }
};

export const courseEnrollGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (req.session.user) {
      const course = await validateCourse(req, res);
      if (course === null) return;
      const user = req.session.user;
      await courseService.enrollCourse(course, user);
      return res.redirect(`/courses/${course.id}`);
    }
    return res.redirect('/auth/login');
  }
);

export const approveEnrollGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { enrollmentId } = req.params;
    const userSession = req.session.user;
    if (userSession && userSession.role === UserRole.INSTRUCTOR) {
      await courseService.approveEnrollment(enrollmentId);
      return res.redirect('back');
    }
    return res.redirect('/auth/login');
  }
);

export const rejectEnrollGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { enrollmentId } = req.params;
    const userSession = req.session.user;
    if (userSession && userSession.role === UserRole.INSTRUCTOR) {
      await courseService.rejectEnrollment(enrollmentId);
      return res.redirect('back');
    }
    return res.redirect('/auth/login');
  }
);

export const courseManageGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const currentLessonPage = parseInt(req.query.lessonPage as string) || 1;
    const currentGradePage = parseInt(req.query.gradePage as string) || 1;
    const userSession = req.session.user;
    const course = await validateCourse(req, res);
    if (!course) return;
    if (
      (userSession && course.instructor.id === userSession.id) ||
      (userSession && course.subInstructor?.id === userSession.id) ||
      (userSession && userSession.role === UserRole.ADMIN)
    ) {
      const enrollmentIdDelete = req.params.enrollmentId;
      const enrollments = await courseService.getEnrollmentForCourse(course);
      const lessons = await lessonService.getLessonListAdmin(course.id);
      const totalLessonPages = Math.ceil(lessons.length / LIMIT_RECORDS);

      const grades = await getAllUserGradesByCourseId(course.id);
      const totalGradePages = Math.ceil(grades.length / LIMIT_RECORDS);
      const enrollmentWithProgress: EnrollmentWithProgress[] = [];

      for (const enrollment of enrollments) {
        if (enrollment.status !== EnrollStatus.APPROVED) continue;

        const progress = await courseService.getProgressInCourse(
          course,
          enrollment.student
        );

        let courseStatus = CourseStatus.NOTSTARTED;
        if (progress > 0) {
          courseStatus = CourseStatus.INPROGRESS;
        }

        if (progress === 100) {
          courseStatus = CourseStatus.COMPLETED;
        }
        enrollmentWithProgress.push({ ...enrollment, progress, courseStatus });
      }

      res.render('courses/manage', {
        title: req.t('title.course_detail'),
        course,
        enrollmentIdDelete,
        enrollments,
        enrollmentWithProgress,
        lessons: lessons.slice(
          (currentLessonPage - 1) * LIMIT_RECORDS,
          currentLessonPage * LIMIT_RECORDS
        ),
        currentLessonPage,
        totalLessonPages,
        LIMIT_RECORDS,
        grades: grades.slice(
          (currentGradePage - 1) * LIMIT_RECORDS,
          currentGradePage * LIMIT_RECORDS
        ),
        currentGradePage,
        totalGradePages,
      });
    } else {
      req.flash('error', i18next.t('error.permissionDenied'));
      res.redirect('/error');
    }
  }
);

export const deleteEnrollPost = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { enrollmentId } = req.body;
    await courseService.deleteEnrollment(enrollmentId);

    const courseId = req.params.id;
    return res.redirect(`/courses/${courseId}/manage`);
  }
);

export const courseCreateGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { subInstructors, lessons } = await getAttributesForView(req, res);
    res.render('courses/form', {
      title: req.t('title.create_course'),
      subInstructors,
      lessons,
    });
  }
);

export const courseCreatePost = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const instructor = req.session.user!;
    req.body.image_url = await uploadImage(req);

    const course = await courseService.createCourse(req.body, instructor);
    res.redirect(`/courses/${course.id}`);
  }
);

export const courseDeleteGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const attributes = await getAttributesForView(req, res);
    if (!attributes.course) return;
    const studentCount = await courseService.getStudentCountByCourseId(
      attributes.course.id
    );
    res.render('courses/form', {
      title: req.t('title.edit_course'),
      ...attributes,
      studentCount,
    });
  }
);

export const courseDeletePost = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    await courseService.deleteCourse(req.body.courseId);
    res.redirect('/courses');
  }
);

export const courseUpdateGet = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const attributes = await getAttributesForView(req, res);
    res.render('courses/form', {
      title: req.t('title.edit_course'),
      ...attributes,
    });
  }
);

export const courseUpdatePost = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const course = await validateCourse(req, res);
    if (!course) return;
    req.body.image_url = await uploadImage(req);

    await courseService.updateCourse(course, req.body);
    res.redirect(`/courses/${course.id}`);
  }
);
