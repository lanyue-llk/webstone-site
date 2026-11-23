"use client";

import { useEffect } from "react";
import { SUBMISSION_URL } from "../../lib/overview";

export default function SubmitPage() {
  useEffect(() => window.location.replace(SUBMISSION_URL), []);
  return <main className="main-content"><a href={SUBMISSION_URL}>Submission instructions on GitHub</a></main>;
}
