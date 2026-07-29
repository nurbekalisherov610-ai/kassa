import PDFDocument from 'pdfkit';
import { sheetsService } from './sheets';

export const reportService = {
    async generateDailyReport(): Promise<Buffer> {
        return new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const buffers: Buffer[] = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfData = Buffer.concat(buffers);
                    resolve(pdfData);
                });

                // Ma'lumotlarni olish
                const deals = await sheetsService.getParsedData();
                const stats = await sheetsService.getOverallStats();
                const leaderboard = await sheetsService.getLeaderboard();

                // ... (header code remains same) ...

                // =================== HEADER ===================
                doc.fontSize(22).font('Helvetica-Bold')
                    .text('LEMON TOUR', { align: 'center' });
                doc.fontSize(12).font('Helvetica')
                    .text('Savdo hisoboti', { align: 'center' });
                doc.moveDown(0.5);

                const now = new Date();
                doc.fontSize(10)
                    .text(`Sana: ${now.toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`, { align: 'right' });
                doc.moveDown();

                // =================== UMUMIY STATISTIKA ===================
                const boxTop = doc.y;
                doc.rect(50, boxTop, 500, 100).fillAndStroke('#f0f4ff', '#3b82f6');

                doc.fillColor('#1e3a5f');
                doc.fontSize(14).font('Helvetica-Bold')
                    .text('Umumiy statistika', 65, boxTop + 10);

                doc.fontSize(11).font('Helvetica');
                doc.fillColor('#333');

                // 1-chi qator
                doc.text(`Bugungi savdolar: ${stats.todayCount} ta ($${stats.todayTotal.toLocaleString()})`, 65, boxTop + 35);
                doc.text(`Haftalik: ${stats.weekCount} ta ($${stats.weekTotal.toLocaleString()})`, 320, boxTop + 35);

                // 2-chi qator
                doc.text(`Oylik: ${stats.monthCount} ta ($${stats.monthTotal.toLocaleString()})`, 65, boxTop + 55);
                doc.text(`Barcha davr: ${stats.allCount} ta ($${stats.allTotal.toLocaleString()})`, 320, boxTop + 55);
                doc.text('Ko‘rsatkichlar tasdiqlangan savdolar asosida hisoblangan.', 65, boxTop + 75);

                doc.y = boxTop + 115;

                // =================== MENEJERLAR REYTINGI ===================
                doc.fillColor('#000');
                doc.fontSize(14).font('Helvetica-Bold')
                    .text('Menejerlar reytingi (Joriy oy)');
                doc.moveDown(0.5);

                const leaderTop = doc.y;
                doc.fontSize(10).font('Helvetica-Bold');
                doc.text('#', 50, leaderTop);
                doc.text('Menejer', 80, leaderTop);
                doc.text('Savdolar', 250, leaderTop);
                doc.text('Jami summa', 350, leaderTop);
                doc.moveTo(50, leaderTop + 15).lineTo(550, leaderTop + 15).stroke();

                let ly = leaderTop + 22;
                doc.font('Helvetica').fontSize(10);

                leaderboard.forEach((m, i) => {
                    const medal = i === 0 ? '1.' : i === 1 ? '2.' : i === 2 ? '3.' : `${i + 1}.`;
                    doc.text(medal, 50, ly);
                    doc.text(m.name, 80, ly);
                    doc.text(`${m.count} ta`, 250, ly);
                    doc.text(`$${m.total.toLocaleString()}`, 350, ly);
                    ly += 18;
                });

                if (leaderboard.length === 0) {
                    doc.text('Ma\'lumot topilmadi', 80, ly);
                    ly += 18;
                }

                doc.y = ly + 15;

                // =================== OXIRGI SAVDOLAR ===================
                doc.fontSize(14).font('Helvetica-Bold')
                    .text('Oxirgi savdolar');
                doc.moveDown(0.5);

                const tableTop = doc.y;
                doc.fontSize(9).font('Helvetica-Bold');
                doc.text('Sana', 50, tableTop);
                doc.text('ID', 115, tableTop);
                doc.text('Mijoz', 185, tableTop);
                doc.text('Yo\'nalish', 275, tableTop);
                doc.text('Narx', 360, tableTop);
                doc.text('Odamlar', 420, tableTop);
                doc.text('Menejer', 475, tableTop);
                doc.moveTo(50, tableTop + 13).lineTo(550, tableTop + 13).stroke();

                let y = tableTop + 20;
                doc.font('Helvetica').fontSize(9);

                // Use ParsedDeal properties instead of indices
                const recentDeals = deals.slice(-20).reverse();

                recentDeals.forEach(deal => {
                    if (y > 720) {
                        doc.addPage();
                        y = 50;
                    }
                    // deal.timestamp, deal.dealId, etc.
                    doc.text((deal.timestamp || '').substring(0, 10), 50, y);
                    doc.text((deal.dealId || '').substring(0, 18), 115, y);
                    doc.text((deal.clientName || '').substring(0, 14), 185, y);
                    doc.text((deal.destination || '').substring(0, 12), 275, y);
                    doc.text(`$${deal.price || 0}`, 360, y);
                    doc.text(`${deal.numberOfPeople || '-'}`, 420, y);
                    doc.text((deal.managerName || '').substring(0, 12), 475, y);
                    y += 16;
                });

                // =================== FOOTER ===================
                doc.fontSize(8).fillColor('#999')
                    .text(
                        'Lemon Tour Bot tomonidan avtomatik yaratildi',
                        50, 750,
                        { align: 'center', width: 500 }
                    );

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
};
