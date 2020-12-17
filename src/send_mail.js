"use strict";

const path = require('path');
const nodemailer = require("nodemailer");
const settings = require('../config.json');

/*
* Send mail to corresponding mail list
* @param {String}, subject, represents mail's subject
* @param {String}, html, uses html document to repensent mail content
* @param {Array<String>}, chartImages, trend chart image file names in attachment
*/
async function sendMail(to, subject, html, chartImages=[]) {
  let from = "webgraphics@intel.com";

  // Create reusable transporter object
  let transporter = nodemailer.createTransport({
    host: "smtp.intel.com",
    port: 25,
    secure: false,
    auth: {
      user: "",
      pass: "",
    },
  });

  // Verify transporter is avaliable
  transporter.verify(error => {
    if(error)
      console.error("transporter error: ", error);
    else
      console.log('server is ready to take our messages!');
  });

  let charts = [];
  if (chartImages.length !== 0) {
    for (let chartImage of chartImages) {
      let absChart = path.join(process.cwd(), 'charts', chartImage);
      charts.push({
        filename: chartImage,
        path: absChart,
        cid: chartImage.replace('.png', '')
      });
    }
  }
  // send mail with defined transport object
  let info = await transporter.sendMail({
    from: from, // sender address
    to: to, // list of receivers
    subject: subject, // Subject line
    html: html, // html body,
    attachments: charts
  });
  return Promise.resolve();
}

module.exports = sendMail;