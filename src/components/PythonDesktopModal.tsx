import React, { useState } from 'react';
import { X, Copy, Check, Download, Terminal, FileCode, CheckCircle2 } from 'lucide-react';
import { DataPoint, InterpolationMethod } from '../types';

interface PythonDesktopModalProps {
  isOpen: boolean;
  onClose: () => void;
  points: DataPoint[];
  method: InterpolationMethod;
  polynomialDegree?: number;
  targetX: number;
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
}

export const PythonDesktopModal: React.FC<PythonDesktopModalProps> = ({
  isOpen,
  onClose,
  points,
  method,
  polynomialDegree = 2,
  targetX,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
}) => {
  const [activeTab, setActiveTab] = useState<'python' | 'requirements' | 'pyinstaller'>('python');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const initialPointsPython = points
    .map(p => `        (${p.x}, ${p.y}),`)
    .join('\n');

  const defaultMethodIdx = method === 'cubic-spline' ? 0 : method === 'linear' ? 1 : 2;

  const pythonScript = `"""
Fastmin Calc — Автоматизация расчетно-графического определения функции Fas min
Разработано в соответствии с ТЗ ГОСТ 19 / 34 для Выпускной Квалификационной Работы (ВКР).
Стек: Python 3.10+, PyQt6, NumPy (np.polyfit / МНК), SciPy (CubicSpline), Matplotlib
"""

import sys
import numpy as np
from scipy.interpolate import CubicSpline
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTableWidget, QTableWidgetItem, QPushButton, QLabel, QLineEdit,
    QComboBox, QMessageBox, QGroupBox, QHeaderView, QSplitter
)
from PyQt6.QtCore import Qt
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavigationToolbar
from matplotlib.figure import Figure


class FastminCalcWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Fastmin Calc — Расчет функции Fas min (ВКР)")
        self.resize(1120, 720)
        self.setMinimumSize(1000, 620)
        
        self.init_ui()
        self.load_initial_data()
        self.calculate()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        
        splitter = QSplitter(Qt.Orientation.Horizontal)
        main_layout.addWidget(splitter)

        # ------------------ ЛЕВАЯ ПАНЕЛЬ: ВВОД И УПРАВЛЕНИЕ ------------------
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(10, 10, 10, 10)
        left_layout.setSpacing(12)

        # 1. Таблица опорных точек
        table_group = QGroupBox("Табличный ввод экспериментальной кривой")
        table_layout = QVBoxLayout(table_group)
        
        self.table = QTableWidget()
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels(["${xLabel} [${xUnit}]", "${yLabel} [${yUnit}]"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        table_layout.addWidget(self.table)

        btn_row = QHBoxLayout()
        self.btn_add_row = QPushButton("+ Добавить строку")
        self.btn_add_row.clicked.connect(self.add_row)
        btn_row.addWidget(self.btn_add_row)

        self.btn_del_row = QPushButton("Удалить строку")
        self.btn_del_row.clicked.connect(self.del_row)
        btn_row.addWidget(self.btn_del_row)

        self.btn_sort = QPushButton("Сортировать по X")
        self.btn_sort.clicked.connect(self.sort_points)
        btn_row.addWidget(self.btn_sort)
        table_layout.addLayout(btn_row)

        left_layout.addWidget(table_group)

        # 2. Вычислительное ядро: параметры
        calc_group = QGroupBox("Параметры расчетной точки и метод")
        calc_layout = QVBoxLayout(calc_group)

        # Метод
        method_row = QHBoxLayout()
        method_row.addWidget(QLabel("Метод интерполяции:"))
        self.combo_method = QComboBox()
        self.combo_method.addItems([
            "Кубический сплайн (Cubic Spline)",
            "Кусочно-линейная",
            "МНК полином (NumPy np.polyfit)"
        ])
        self.combo_method.setCurrentIndex(${defaultMethodIdx})
        self.combo_method.currentIndexChanged.connect(self.on_method_changed)
        method_row.addWidget(self.combo_method)
        calc_layout.addLayout(method_row)

        # Степень полинома МНК
        self.degree_row_widget = QWidget()
        degree_layout = QHBoxLayout(self.degree_row_widget)
        degree_layout.setContentsMargins(0, 0, 0, 0)
        degree_layout.addWidget(QLabel("Степень полинома (n):"))
        self.combo_degree = QComboBox()
        self.combo_degree.addItems([
            "1 (линейная регрессия)",
            "2 (квадратичная парабола)",
            "3 (кубическая)",
            "4 (4-я степень)",
            "5 (5-я степень)"
        ])
        self.combo_degree.setCurrentIndex(${Math.max(0, Math.min(4, polynomialDegree - 1))})
        self.combo_degree.currentIndexChanged.connect(self.calculate)
        degree_layout.addWidget(self.combo_degree)
        calc_layout.addWidget(self.degree_row_widget)
        self.degree_row_widget.setVisible(${defaultMethodIdx === 2 ? 'True' : 'False'})

        # Xцел
        target_row = QHBoxLayout()
        target_row.addWidget(QLabel("Целевое значение Xцел:"))
        self.input_target_x = QLineEdit(str(${targetX}))
        target_row.addWidget(self.input_target_x)
        calc_layout.addLayout(target_row)

        # Точность
        prec_row = QHBoxLayout()
        prec_row.addWidget(QLabel("Округление (знаков):"))
        self.combo_precision = QComboBox()
        self.combo_precision.addItems(["1", "2", "3 (ГОСТ)", "4", "5"])
        self.combo_precision.setCurrentIndex(2)
        prec_row.addWidget(self.combo_precision)
        calc_layout.addLayout(prec_row)

        # Кнопка расчета
        self.btn_calc = QPushButton("Рассчитать Fas min")
        self.btn_calc.setStyleSheet("background-color: #2563eb; color: white; font-weight: bold; padding: 8px;")
        self.btn_calc.clicked.connect(self.calculate)
        calc_layout.addWidget(self.btn_calc)

        left_layout.addWidget(calc_group)

        # 3. Информационный блок вывода результатов
        result_group = QGroupBox("Результат расчета (Yрасч)")
        result_layout = QVBoxLayout(result_group)
        self.label_result = QLabel("Yрасч = —")
        self.label_result.setStyleSheet("font-size: 18px; font-weight: bold; color: #059669; padding: 4px;")
        result_layout.addWidget(self.label_result)
        
        self.label_status = QLabel("Статус: готов")
        self.label_status.setStyleSheet("font-size: 11px; color: #64748b;")
        result_layout.addWidget(self.label_status)

        # Коэффициенты МНК полинома
        self.label_coeffs = QLabel("")
        self.label_coeffs.setStyleSheet("font-family: monospace; font-size: 10px; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px;")
        self.label_coeffs.setVisible(False)
        result_layout.addWidget(self.label_coeffs)
        
        left_layout.addWidget(result_group)

        splitter.addWidget(left_panel)

        # ------------------ ПРАВАЯ ПАНЕЛЬ: ГРАФИК MATPLOTLIB ------------------
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(10, 10, 10, 10)

        self.figure = Figure(figsize=(7, 5), dpi=100)
        self.canvas = FigureCanvas(self.figure)
        self.toolbar = NavigationToolbar(self.canvas, self)

        right_layout.addWidget(self.toolbar)
        right_layout.addWidget(self.canvas)

        splitter.addWidget(right_panel)
        splitter.setStretchFactor(0, 4)
        splitter.setStretchFactor(1, 6)

    def on_method_changed(self):
        is_mnk = (self.combo_method.currentIndex() == 2)
        self.degree_row_widget.setVisible(is_mnk)
        self.calculate()

    def load_initial_data(self):
        initial = [
${initialPointsPython}
        ]
        self.table.setRowCount(len(initial))
        for row, (x, y) in enumerate(initial):
            self.table.setItem(row, 0, QTableWidgetItem(str(x)))
            self.table.setItem(row, 1, QTableWidgetItem(str(y)))

    def add_row(self):
        row = self.table.rowCount()
        self.table.insertRow(row)
        self.table.setItem(row, 0, QTableWidgetItem("0.0"))
        self.table.setItem(row, 1, QTableWidgetItem("0.0"))

    def del_row(self):
        current_row = self.table.currentRow()
        if current_row >= 0:
            self.table.removeRow(current_row)
        elif self.table.rowCount() > 0:
            self.table.removeRow(self.table.rowCount() - 1)

    def get_points(self):
        points = []
        for r in range(self.table.rowCount()):
            item_x = self.table.item(r, 0)
            item_y = self.table.item(r, 1)
            if item_x and item_y:
                x_str = item_x.text().replace(',', '.').strip()
                y_str = item_y.text().replace(',', '.').strip()
                try:
                    points.append((float(x_str), float(y_str)))
                except ValueError:
                    continue
        return points

    def sort_points(self):
        pts = self.get_points()
        pts.sort(key=lambda p: p[0])
        self.table.setRowCount(len(pts))
        for r, (x, y) in enumerate(pts):
            self.table.setItem(r, 0, QTableWidgetItem(str(x)))
            self.table.setItem(r, 1, QTableWidgetItem(str(y)))

    def calculate(self):
        pts = self.get_points()
        method_idx = self.combo_method.currentIndex() # 0: Spline, 1: Linear, 2: MNK Polynomial
        poly_degree = self.combo_degree.currentIndex() + 1
        
        if method_idx == 0:
            min_required = 3
        elif method_idx == 1:
            min_required = 2
        else:
            min_required = poly_degree + 1

        # Валидация 1: Недостаточное количество точек
        if len(pts) < min_required:
            QMessageBox.critical(
                self, "Ошибка исходных данных",
                f"Недостаточно точек для расчета! Для выбранного метода требуется минимум {min_required} точек."
            )
            return

        # Сортировка по возрастанию X
        pts.sort(key=lambda p: p[0])
        x_vals = np.array([p[0] for p in pts])
        y_vals = np.array([p[1] for p in pts])

        # Валидация 2: Дублирование значений X
        if len(np.unique(x_vals)) != len(x_vals):
            QMessageBox.critical(
                self, "Ошибка функциональной однозначности",
                "Обнаружены дубликаты аргумента X! Функция y = F(x) должна быть однозначной."
            )
            return

        # Валидация 3: Целевое значение Xцел
        x_target_str = self.input_target_x.text().replace(',', '.').strip()
        try:
            x_target = float(x_target_str)
        except ValueError:
            QMessageBox.critical(
                self, "Ошибка ввода",
                f"Некорректное значение Xцел: '{x_target_str}'. Введите вещественное число."
            )
            return

        # Граничные условия и экстраполяция
        x_min, x_max = x_vals[0], x_vals[-1]
        is_extrapolated = (x_target < x_min or x_target > x_max)
        if is_extrapolated:
            QMessageBox.warning(
                self, "Предупреждение: Экстраполяция",
                f"Целевая точка Xцел = {x_target} выходит за пределы диапазона [{x_min}, {x_max}]!\\n"
                "Расчет выполняется в режиме экстраполяции."
            )

        # Вычисление
        prec = int(self.combo_precision.currentText().split()[0])
        curve_label = ""
        
        if method_idx == 0:  # Cubic Spline
            cs = CubicSpline(x_vals, y_vals, bc_type='natural', extrapolate=True)
            y_target = float(cs(x_target))
            plot_x_min = min(x_min, x_target) - (x_max - x_min)*0.1
            plot_x_max = max(x_max, x_target) + (x_max - x_min)*0.1
            dense_x = np.linspace(plot_x_min, plot_x_max, 400)
            dense_y = cs(dense_x)
            self.label_coeffs.setVisible(False)
            curve_label = "Кубический сплайн (SciPy)"
        elif method_idx == 1:  # Линейная
            y_target = float(np.interp(x_target, x_vals, y_vals))
            plot_x_min = min(x_min, x_target) - (x_max - x_min)*0.1
            plot_x_max = max(x_max, x_target) + (x_max - x_min)*0.1
            dense_x = np.linspace(plot_x_min, plot_x_max, 400)
            dense_y = np.interp(dense_x, x_vals, y_vals)
            self.label_coeffs.setVisible(False)
            curve_label = "Кусочно-линейная"
        else:  # МНК полином (NumPy np.polyfit)
            # Расчет методом наименьших квадратов
            coeffs = np.polyfit(x_vals, y_vals, deg=poly_degree)
            poly_model = np.poly1d(coeffs)
            y_target = float(poly_model(x_target))
            
            # Оценка точности модели (R² и RMSE)
            fitted_y = poly_model(x_vals)
            ss_res = float(np.sum((y_vals - fitted_y) ** 2))
            ss_tot = float(np.sum((y_vals - np.mean(y_vals)) ** 2))
            r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 1.0
            rmse = float(np.sqrt(ss_res / len(y_vals)))
            
            # Построение плавной кривой полинома
            plot_x_min = min(x_min, x_target) - (x_max - x_min)*0.1
            plot_x_max = max(x_max, x_target) + (x_max - x_min)*0.1
            dense_x = np.linspace(plot_x_min, plot_x_max, 400)
            dense_y = poly_model(dense_x)
            
            # Вывод коэффициентов полинома в интерфейс
            coeffs_lines = [f"МНК Полином P_{poly_degree}(x):"]
            for idx, c in enumerate(coeffs):
                power = poly_degree - idx
                term = f"c_{power}" if power > 0 else "c_0"
                coeffs_lines.append(f"  {term} = {c:+.6e} ({c:.{prec+2}f})")
            coeffs_lines.append(f"  R² = {r_squared:.4f}, RMSE = {rmse:.4f}")
            self.label_coeffs.setText("\\n".join(coeffs_lines))
            self.label_coeffs.setVisible(True)
            curve_label = f"МНК P_{poly_degree}(x) [NumPy, R²={r_squared:.4f}]"

        # Вывод результатов в интерфейс
        self.label_result.setText(f"Yрасч = {y_target:.{prec}f} ${yUnit}")
        if is_extrapolated:
            self.label_status.setText(f"Внимание: расчет в режиме экстраполяции (X < {x_min} или X > {x_max})")
            self.label_status.setStyleSheet("font-size: 11px; color: #b45309; font-weight: bold;")
        else:
            self.label_status.setText(f"Интерполяция в рабочем диапазоне [{x_min}, {x_max}]")
            self.label_status.setStyleSheet("font-size: 11px; color: #059669;")

        # Отрисовка графика Matplotlib (Раздел 3.3 ТЗ)
        self.plot_graph(x_vals, y_vals, dense_x, dense_y, x_target, y_target, prec, curve_label)

    def plot_graph(self, x_pts, y_pts, dense_x, dense_y, x_target, y_target, prec, curve_label):
        self.figure.clear()
        ax = self.figure.add_subplot(111)
        
        # Сетка
        ax.grid(True, linestyle='--', alpha=0.6)

        # Кривая
        curve_color = '#0d9488' if self.combo_method.currentIndex() == 2 else '#2563eb'
        ax.plot(dense_x, dense_y, color=curve_color, linewidth=2.2, label=curve_label)

        # Опорные точки эксперимента
        ax.scatter(x_pts, y_pts, color='#0f172a', s=45, zorder=4, label=f"Опорные точки ({len(x_pts)})")

        # Целевая расчетная точка
        ax.scatter([x_target], [y_target], color='#059669', s=90, edgecolors='white', linewidths=2, zorder=5,
                   label=f"Рабочая точка ({x_target:.{prec}f}, {y_target:.{prec}f})")

        # Пунктирные проекции на оси
        ax.axvline(x=x_target, color='#059669', linestyle=':', alpha=0.8, linewidth=1.5)
        ax.axhline(y=y_target, color='#059669', linestyle=':', alpha=0.8, linewidth=1.5)

        # Подписи осей и заголовок
        ax.set_xlabel("${xLabel} [${xUnit}]", fontsize=11, fontweight='bold')
        ax.set_ylabel("${yLabel} [${yUnit}]", fontsize=11, fontweight='bold')
        ax.set_title("Определение рабочей точки Fas min полупроводникового ключа", fontsize=12, pad=10)
        ax.legend(loc='upper right', framealpha=0.9)

        self.canvas.draw()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = FastminCalcWindow()
    window.show()
    sys.exit(app.exec())
`;

  const requirementsTxt = `PyQt6>=6.5.0
numpy>=1.24.0
scipy>=1.10.0
matplotlib>=3.7.0
`;

  const pyinstallerCmd = `# Сборка автономного исполняемого файла (.exe для Windows или бинарника для Linux)
# Требуется установленный PyInstaller: pip install pyinstaller

# Для сборки единого файла без консоли (GUI):
pyinstaller --onefile --windowed --name="FastminCalc" fastmin_calc.py

# Результат сборки появится в папке dist/FastminCalc.exe (Windows) или dist/FastminCalc (Linux)
`;

  const activeContent =
    activeTab === 'python'
      ? pythonScript
      : activeTab === 'requirements'
      ? requirementsTxt
      : pyinstallerCmd;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    let filename = 'fastmin_calc.py';
    let mime = 'text/x-python';
    if (activeTab === 'requirements') {
      filename = 'requirements.txt';
      mime = 'text/plain';
    } else if (activeTab === 'pyinstaller') {
      filename = 'build.sh';
      mime = 'text/x-sh';
    }

    const blob = new Blob([activeContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileCode className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold">
                Экспорт десктопного исходного кода «Fastmin Calc» (ГОСТ 19 / 34)
              </h2>
              <p className="text-xs text-slate-400">
                Полная реализация требований разделов 2, 3 и 4 ТЗ на стеке Python + PyQt6 + SciPy + Matplotlib
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-sm transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-slate-100 px-5 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('python')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'python'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-semibold'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              fastmin_calc.py (PyQt6 + SciPy)
            </button>
            <button
              onClick={() => setActiveTab('requirements')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'requirements'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-semibold'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              requirements.txt
            </button>
            <button
              onClick={() => setActiveTab('pyinstaller')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'pyinstaller'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200 font-semibold'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Сборка PyInstaller (.exe)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать файл</span>
            </button>
          </div>
        </div>

        {/* Code Content Box */}
        <div className="flex-1 p-4 bg-slate-950 overflow-y-auto font-mono text-xs text-slate-200">
          <pre className="leading-relaxed whitespace-pre font-mono">
            {activeContent}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
          <span>
            Готово к включению в приложение к дипломной работе (ВКР) или непосредственному запуску на Windows/Linux.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-medium"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
