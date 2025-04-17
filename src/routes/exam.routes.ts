import { Router, Response, NextFunction } from 'express';
import * as examController from '../controllers/exam.controller';
import { RequestWithCourseID } from '../helpers/lesson.helper';
import { requireUser } from '../middleware/require-user.middleware';

const router: Router = Router();

router.use((req: RequestWithCourseID, res: Response, next: NextFunction) => {
  req.courseID = req.baseUrl.split('/')[2];
  next();
});

router.use(requireUser);

router.get('/create', examController.examCreateGet);

router.post('/create', examController.examCreatePost);

router.get('/:id/delete', examController.examDeleteGet);

router.post('/:id/delete', examController.examDeletePost);

router.get('/:id/update', examController.examUpdateGet);

router.post('/:id/update', examController.examUpdatePost);

router.post('/:id/save-answer', examController.saveAnswer);

router.post('/:id/result', examController.addFeedBackPost);

router.get('/:id/result', examController.resultExam);

router.get('/:id', examController.getExamDetail);

router.post('/:id', examController.submitExam);

router.get('/', examController.getExamInfo);

export default router;
