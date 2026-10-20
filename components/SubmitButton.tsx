"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

/**
 * A submit button that shows it is working and cannot be pressed again until the request is done.
 * Drop-in for <button> inside a <form action={...}>.
 */
export function SubmitButton({ children, disabled, className = "", type = "submit", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} type={type} className={`${className}${pending ? " is-pending" : ""}`} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
