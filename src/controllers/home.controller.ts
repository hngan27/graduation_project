import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import * as userService from '../services/user.service';
import * as courseService from '../services/course.service';
import {
  CourseWithEnrollStatus,
  CourseWithProgress,
} from '../helpers/course.helper';
import { EnrollStatus } from '../enums/EnrollStatus';
import { CourseStatus } from '../enums/CourseStatus';

export const index = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let instructors = await userService.getInstructorList();
    const students = await userService.getStudentList();

    const allCourses = await courseService.getCourseList();
    let myCourses: CourseWithEnrollStatus[] = [];
    const courseLearns: CourseWithProgress[] = [];
    if (req.session.user) {
      const userSession = req.session.user;
      instructors = userService.sortInstructorByMajor(instructors, userSession);

      myCourses = await courseService.getUserCourseList(userSession);

      for (const course of myCourses) {
        if (course.enrollStatus !== EnrollStatus.APPROVED) {
          continue;
        }

        const progress = await courseService.getProgressInCourse(
          course,
          userSession
        );

        let status = CourseStatus.NOTSTARTED;
        if (progress > 0) {
          status = CourseStatus.INPROGRESS;
        }

        if (progress === 100) {
          status = CourseStatus.COMPLETED;
        }

        courseLearns.push({
          ...course,
          progress,
          status,
        });
      }
    }

    const courseRecommends = allCourses.filter(
      course => !myCourses.find(myCourse => myCourse.id === course.id)
    );

    res.render('index', {
      title: 'Smart Education',
      myCourses,
      courseRecommends,
      courseLearns,
      instructors,
      students,
      totalCourses: myCourses.length,
      totalLessons: courseLearns.reduce(
        (total, course) => total + course.lessons.length,
        0
      ),
      totalAssignments: courseLearns.reduce(
        (total, course) => total + (course.assignment ? 1 : 0),
        0
      ),
      currentPath: req.baseUrl + req.path,
      user: res.locals.user || null,
    });
  }
);

export const error = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    res.render('error', {
      title: req.t('error.title'),
    });
  }
);
