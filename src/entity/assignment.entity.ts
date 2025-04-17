import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Course } from './course.entity';
import { Question } from './question.entity';
import { Grade } from './grade.entity';

@Entity('assignments')
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'datetime', nullable: true })
  deadline: Date;

  @Column({ nullable: true })
  time_limit: number;

  @Column({ nullable: true })
  attempt_limit: number;

  @OneToOne(() => Course, course => course.assignment, { nullable: false })
  @JoinColumn({ name: 'course_id' })
  course: Course;

  @OneToMany(() => Question, question => question.assignment)
  questions: Question[];

  @OneToMany(() => Grade, grade => grade.assignment)
  grades: Grade[];

  constructor(partial?: Partial<Assignment>) {
    Object.assign(this, partial);
  }
}
