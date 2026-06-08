import { PrismaClient } from '@prisma/client';
import { initScheduler } from './scheduler';

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

initScheduler(prisma);

export default prisma;
