import React, { useState, useEffect, useRef } from "react";
import styles from "./DateTimePicker.module.css";

const parseValue = (val) => {
  if (!val) {
    const now = new Date();
    return {
      date: now,
      hour: now.getHours() % 12 === 0 ? 12 : now.getHours() % 12,
      minute: now.getMinutes(),
      isPM: now.getHours() >= 12
    };
  }
  const d = new Date(val.replace(" ", "T"));
  if (isNaN(d.getTime())) {
    const now = new Date();
    return {
      date: now,
      hour: now.getHours() % 12 === 0 ? 12 : now.getHours() % 12,
      minute: now.getMinutes(),
      isPM: now.getHours() >= 12
    };
  }
  const rawHour = d.getHours();
  return {
    date: d,
    hour: rawHour % 12 === 0 ? 12 : rawHour % 12,
    minute: d.getMinutes(),
    isPM: rawHour >= 12
  };
};

export default function DateTimePicker({
  value,
  onChange,
  required = false,
  disabled = false,
  className = "",
  style = {},
  placeholder = "Seleccionar fecha y hora..."
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, openUpward: false });
  const wrapperRef = useRef(null);
  
  // Temp internal picker state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  
  const [selectedHour, setSelectedHour] = useState(12);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isPM, setIsPM] = useState(false);
  
  // Selection mode: true = hours, false = minutes
  const [selectingHours, setSelectingHours] = useState(true);

  const popoverRef = useRef(null);
  const POPOVER_HEIGHT = 420; // Estimated popover height in px

  // Helper arrays
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const dayLabels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  // Sync internal state only when external value changes
  useEffect(() => {
    if (value) {
      const parsed = parseValue(value);
      setSelectedDate(parsed.date);
      setViewMonth(parsed.date.getMonth());
      setViewYear(parsed.date.getFullYear());
      setSelectedHour(parsed.hour);
      setSelectedMinute(parsed.minute);
      setIsPM(parsed.isPM);
    }
  }, [value]);

  // Handle clicking outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setShowPicker(false);
      }
    }
    if (showPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPicker]);

  const getFormattedInputString = () => {
    if (!value) return "";
    const parsed = parseValue(value);
    const day = parsed.date.getDate().toString().padStart(2, "0");
    const month = (parsed.date.getMonth() + 1).toString().padStart(2, "0");
    const year = parsed.date.getFullYear();
    const hours = (parsed.isPM 
      ? (parsed.hour === 12 ? 12 : parsed.hour + 12) 
      : (parsed.hour === 12 ? 0 : parsed.hour)
    ).toString().padStart(2, "0");
    const minutes = parsed.minute.toString().padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  // Month navigation logic
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  // Calendar days generation
  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
  const getFirstDayIndex = (month, year) => new Date(year, month, 1).getDay();

  const daysInMonth = getDaysInMonth(viewMonth, viewYear);
  const firstDayIndex = getFirstDayIndex(viewMonth, viewYear);

  const handleSelectDay = (day) => {
    const newDate = new Date(selectedDate);
    newDate.setFullYear(viewYear);
    newDate.setMonth(viewMonth);
    newDate.setDate(day);
    setSelectedDate(newDate);
  };

  // Clock dial interaction logic
  const handleClockClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    
    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    
    if (selectingHours) {
      let hr = Math.round(angle / 30);
      if (hr === 0) hr = 12;
      setSelectedHour(hr);
      // Wait a moment and switch to selecting minutes automatically for better UX
      setTimeout(() => setSelectingHours(false), 200);
    } else {
      let min = Math.round(angle / 6);
      if (min === 60) min = 0;
      setSelectedMinute(min);
    }
  };

  const handleConfirm = () => {
    let rawHour = selectedHour % 12;
    if (isPM) rawHour += 12;
    
    const year = selectedDate.getFullYear();
    const month = (selectedDate.getMonth() + 1).toString().padStart(2, "0");
    const day = selectedDate.getDate().toString().padStart(2, "0");
    const hh = rawHour.toString().padStart(2, "0");
    const mm = selectedMinute.toString().padStart(2, "0");
    
    const formatted = `${year}-${month}-${day}T${hh}:${mm}`;
    onChange({ target: { value: formatted } });
    setShowPicker(false);
  };

  const handleCancel = () => {
    setShowPicker(false);
  };

  // Helper formatting for selected day banner
  const getWeekdayShort = (date) => dayLabels[date.getDay()];
  const getMonthShort = (date) => monthNames[date.getMonth()].slice(0, 3);

  // Generate Year Options
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear - 5; y <= currentYear + 10; y++) {
    yearOptions.push(y);
  }

  // Calculate clock hand rotation angle
  const handAngle = selectingHours ? (selectedHour * 30) : (selectedMinute * 6);

  const handleTogglePicker = () => {
    if (disabled) return;
    if (!showPicker && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < POPOVER_HEIGHT + 16;
      setPopoverPos({
        top: openUpward ? rect.top : rect.bottom + 6,
        left: rect.left,
        openUpward
      });
    }
    setShowPicker(prev => !prev);
  };

  return (
    <div className={`${styles.container} ${className}`} style={style} ref={wrapperRef}>
      <div className={styles.inputFieldWrapper} onClick={handleTogglePicker} style={disabled ? { opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" } : {}}>
        <input
          type="text"
          readOnly
          required={required}
          value={getFormattedInputString()}
          placeholder={placeholder}
          className={styles.inputField}
        />
        <div className={styles.inputIcon}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
      </div>

      {showPicker && (
        <div
          className={styles.popover}
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: popoverPos.openUpward ? 'auto' : popoverPos.top,
            bottom: popoverPos.openUpward ? (window.innerHeight - popoverPos.top) : 'auto',
            left: popoverPos.left,
            zIndex: 99999
          }}
        >
          <div className={styles.panelsContainer}>
            {/* CALENDAR CARD */}
            <div className={styles.card}>
              <div className={styles.header}>
                <span className={styles.yearText}>{selectedDate.getFullYear()}</span>
                <span className={styles.dateText}>
                  {getWeekdayShort(selectedDate)}, {selectedDate.getDate()} {getMonthShort(selectedDate)}
                </span>
              </div>
              <div className={styles.body}>
                <div className={styles.navRow}>
                  <button type="button" className={styles.navBtn} onClick={handlePrevMonth}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                  </button>
                  <div className={styles.selectGroup}>
                    <select
                      className={styles.select}
                      value={viewMonth}
                      onChange={(e) => setViewMonth(parseInt(e.target.value))}
                    >
                      {monthNames.map((name, idx) => (
                        <option key={idx} value={idx}>{name}</option>
                      ))}
                    </select>
                    <select
                      className={styles.select}
                      value={viewYear}
                      onChange={(e) => setViewYear(parseInt(e.target.value))}
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>{yr}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className={styles.navBtn} onClick={handleNextMonth}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </button>
                </div>

                <div className={styles.weekDays}>
                  {dayLabels.map((lbl, idx) => (
                    <div key={idx}>{lbl[0]}</div>
                  ))}
                </div>

                <div className={styles.daysGrid}>
                  {Array.from({ length: firstDayIndex }).map((_, idx) => (
                    <div key={`empty-${idx}`} className={styles.dayButtonEmpty}></div>
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, idx) => {
                    const dayNum = idx + 1;
                    const isSelected = selectedDate.getDate() === dayNum &&
                                      selectedDate.getMonth() === viewMonth &&
                                      selectedDate.getFullYear() === viewYear;
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        className={`${styles.dayButton} ${isSelected ? styles.dayButtonActive : ""}`}
                        onClick={() => handleSelectDay(dayNum)}
                      >
                        {dayNum}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* CLOCK CARD */}
            <div className={styles.card}>
              <div className={styles.header}>
                <div className={styles.clockTimeDisplay}>
                  <span
                    className={`${styles.timeUnit} ${selectingHours ? styles.timeUnitActive : ""}`}
                    onClick={() => setSelectingHours(true)}
                  >
                    {selectedHour.toString().padStart(2, "0")}
                  </span>
                  <span className={styles.timeDivider}>:</span>
                  <span
                    className={`${styles.timeUnit} ${!selectingHours ? styles.timeUnitActive : ""}`}
                    onClick={() => setSelectingHours(false)}
                  >
                    {selectedMinute.toString().padStart(2, "0")}
                  </span>
                  
                  <div className={styles.ampmCol}>
                    <button
                      type="button"
                      className={`${styles.ampmBtn} ${!isPM ? styles.ampmBtnActive : ""}`}
                      onClick={() => setIsPM(false)}
                    >
                      AM
                    </button>
                    <button
                      type="button"
                      className={`${styles.ampmBtn} ${isPM ? styles.ampmBtnActive : ""}`}
                      onClick={() => setIsPM(true)}
                    >
                      PM
                    </button>
                  </div>
                </div>
              </div>
              <div className={styles.body}>
                <div className={styles.clockFace} onClick={handleClockClick}>
                  <div className={styles.clockCenterDot}></div>
                  
                  {/* Rotating Clock Hand */}
                  <div
                    className={styles.clockHand}
                    style={{
                      height: selectingHours ? "32%" : "38%",
                      transform: `rotate(${handAngle}deg)`
                    }}
                  >
                    <div className={styles.clockHandPin}></div>
                  </div>

                  {/* Draw numbers */}
                  {selectingHours ? (
                    // HOURS VIEW (1 to 12)
                    Array.from({ length: 12 }).map((_, idx) => {
                      const val = idx + 1;
                      const angle = (val * 30 - 90) * (Math.PI / 180);
                      const x = 50 + 38 * Math.cos(angle);
                      const y = 50 + 38 * Math.sin(angle);
                      const active = selectedHour === val;
                      return (
                        <div
                          key={`hr-${val}`}
                          className={`${styles.clockNumber} ${active ? styles.clockNumberActive : ""}`}
                          style={{ left: `${x}%`, top: `${y}%` }}
                        >
                          {val}
                        </div>
                      );
                    })
                  ) : (
                    // MINUTES VIEW (00 to 55 in steps of 5)
                    Array.from({ length: 12 }).map((_, idx) => {
                      const val = idx * 5;
                      const angle = (idx * 30 - 90) * (Math.PI / 180);
                      const x = 50 + 38 * Math.cos(angle);
                      const y = 50 + 38 * Math.sin(angle);
                      const active = selectedMinute === val;
                      return (
                        <div
                          key={`min-${val}`}
                          className={`${styles.clockNumber} ${active ? styles.clockNumberActive : ""}`}
                          style={{ left: `${x}%`, top: `${y}%` }}
                        >
                          {val.toString().padStart(2, "0")}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.footer}>
            <button type="button" className={`${styles.btn} ${styles.btnCancel}`} onClick={handleCancel}>
              Cancelar
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnConfirm}`} onClick={handleConfirm}>
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
