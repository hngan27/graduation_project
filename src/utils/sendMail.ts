import nodemailer from 'nodemailer';

export async function sendAccountEmail(to: string, username: string, password: string, role: string) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: process.env.MAIL_USERNAME,
    to,
    subject: 'Tài khoản E-learning của bạn',
    text: `Chào bạn,\n\nTài khoản E-learning của bạn đã được tạo:\nEmail: ${username}\nMật khẩu: ${password}\nVai trò: ${role}\n\nVui lòng đăng nhập và đổi mật khẩu sau khi sử dụng.\n`,
  };

  await transporter.sendMail(mailOptions);
}
